/* Stage 2 — fetch each booth PDF from Drive, parse it in memory, keep only the
 * rows. The PDF bytes are never written to disk.
 *
 * The whole state is ~32,000 PDFs / ~5.7 GB of paper that we care about only
 * long enough to read a table out of. Streaming turns that into a few hundred
 * MB of NDJSON and leaves nothing to clean up.
 *
 * Resumable: every completed file id is appended to <district>.done, so an
 * interrupted run picks up where it stopped instead of re-fetching.
 *
 *   node scripts/2-extract.mjs                        # whole state
 *   node scripts/2-extract.mjs --district KODAGU      # one district
 *   node scripts/2-extract.mjs --concurrency 8
 */

import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CACHE, driveDownloadUrl, fmtBytes, get, log, pool, progress, readJson, writeJson
} from './lib/common.mjs';
import { looksScanned, parseBoothPdf } from './lib/pdf.mjs';

const OUT_DIR = resolve(CACHE, 'extracted');
const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const only = argValue('--district')?.split(',').map((s) => s.trim().toUpperCase());
// Drive starts throttling past ~8 parallel fetches.
const concurrency = Number(argValue('--concurrency') ?? 6);

const manifest = await readJson(resolve(CACHE, 'manifest.json'));
if (!manifest) {
  log('No manifest. Run `npm run discover` first.');
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const report = {
  files: 0, skipped: 0, failed: 0, scanned: 0, empty: 0, rows: 0, bytes: 0,
  unmappedReasons: {}, byDistrict: {}
};

for (const district of manifest.districts) {
  if (only && !only.some((o) => district.name.includes(o))) continue;

  const base = resolve(OUT_DIR, slug(district.name));
  const donePath = `${base}.done`;
  const done = new Set(
    (await readFile(donePath, 'utf8').catch(() => '')).split('\n').filter(Boolean)
  );

  const jobs = [];
  for (const ac of district.acs) {
    for (const file of ac.files) {
      // Drive files are keyed by id; PDFs hosted on a district site by URL.
      const key = file.id ?? file.url;
      if (key && !done.has(key)) jobs.push({ ac, file, key });
    }
  }
  if (!jobs.length) {
    log(`${district.name}: already complete (${done.size} booths)`);
    continue;
  }

  // Append, so a resumed run adds to what the previous one wrote.
  const out = createWriteStream(`${base}.ndjson`, { encoding: 'utf8', flags: 'a' });
  let districtRows = 0;

  await pool(jobs, concurrency, async ({ ac, file, key }) => {
    report.files++;

    let buf;
    try {
      buf = await get(file.url ?? driveDownloadUrl(file.id));
    } catch {
      report.failed++;
      return;
    }
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      // Throttling and permission changes come back as an HTML page.
      report.failed++;
      return;
    }
    report.bytes += buf.length;

    if (looksScanned(buf)) {
      report.scanned++;
      await appendFile(donePath, key + '\n');
      return;
    }

    const { rows } = parseBoothPdf(buf);
    if (!rows.length) report.empty++;

    let payload = '';
    for (const row of rows) {
      if (row.category === 'others' && row.reasonRaw) {
        report.unmappedReasons[row.reasonRaw] = (report.unmappedReasons[row.reasonRaw] ?? 0) + 1;
      }
      payload += JSON.stringify({
        ...row,
        district: district.name,
        acNo: ac.no ?? file.acNo ?? null,
        acName: ac.name,
        partNo: file.partNo ?? null,
        partName: file.partName ?? '',
        fileId: file.id ?? '',
        fileUrl: file.url ?? '',
        generatedOn: file.generatedOn ?? ''
      }) + '\n';
      districtRows++;
      report.rows++;
    }
    // One write per file keeps whole lines intact under concurrency.
    if (payload) out.write(payload);
    await appendFile(donePath, key + '\n');
    // `buf` goes out of scope here; nothing about this PDF is kept.
  }, (n, total) =>
    progress(`  ${district.name}: ${n}/${total} booths · ${districtRows} rows · ${fmtBytes(report.bytes)} streamed · ${report.failed} failed`)
  );

  await new Promise((r) => out.end(r));
  progress('');
  log(`${district.name}: ${districtRows} rows from ${jobs.length} booths`);
  report.byDistrict[district.name] = districtRows;
}

const unmapped = Object.entries(report.unmappedReasons).sort((a, b) => b[1] - a[1]);
await writeJson(resolve(CACHE, 'extract-report.json'), { ...report, unmappedReasons: unmapped }, true);

log(`\n${report.rows} rows from ${report.files} booth PDFs (${fmtBytes(report.bytes)} streamed, none stored)`);
log(`  failed: ${report.failed}   scanned (unreadable): ${report.scanned}   no rows: ${report.empty}`);
if (report.failed) log('  Re-run to retry failures — completed booths are skipped.');
if (unmapped.length) {
  log(`\n  Reason strings that fell through to "others" (top 10):`);
  for (const [reason, n] of unmapped.slice(0, 10)) log(`    ${String(n).padStart(7)}  ${reason}`);
}
