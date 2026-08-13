/* Stage 2 — fetch each booth PDF from Drive, parse it in memory, keep only the
 * rows. The PDF bytes are never written to disk.
 *
 * Some districts publish a taluk as a single .zip of booth PDFs. Those are
 * fetched once per archive and opened in memory too — nothing is unpacked.
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
  CACHE, driveDownloadUrl, fmtBytes, get, log, pool, progress, readJson, sleep, writeJson
} from './lib/common.mjs';
import { looksScanned, parseBoothPdf } from './lib/pdf.mjs';
import { openArchiveBuffer } from './lib/archive.mjs';

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

/** Identifies a booth for the resume ledger: a Drive id, a URL, or one entry
 *  inside an archive. */
const fileKey = (file) =>
  file.zipId || file.zipUrl ? `${file.zipId ?? file.zipUrl}#${file.entry}` : (file.id ?? file.url);

/**
 * Archives, fetched once and kept open for as long as the district is running.
 *
 * A taluk's zip holds ~250 booths, so fetching it per booth would mean pulling
 * the same few MB 250 times. Keyed by a Promise so concurrent workers hitting
 * the same archive share one fetch instead of racing.
 */
const archives = new Map();
function openArchive(file) {
  const id = file.zipId ?? file.zipUrl;
  if (!archives.has(id)) {
    archives.set(id, (async () => {
      const buf = await get(file.zipUrl ?? driveDownloadUrl(file.zipId));
      report.bytes += buf.length;
      return new Map(openArchiveBuffer(buf).map((e) => [e.name, e]));
    })());
  }
  return archives.get(id);
}

const report = {
  files: 0, skipped: 0, failed: 0, scanned: 0, empty: 0, rows: 0, bytes: 0,
  unmappedReasons: {}, byDistrict: {}, failedFiles: []
};

// Record + log exactly which booth file failed to fetch and why, so the failures
// can be analysed separately: "not-pdf" means Drive returned an HTML page (rate
// limit / permission), "fetch-error" means the request itself failed (404/timeout).
/* A Drive throttle response is a normal HTTP 200 with an HTML page instead of
 * the PDF — not a bad status, not a network error — so get()'s own retry
 * (which only fires on those two) never sees it, and one throttled instant
 * permanently failed the booth for the whole run. #34 (2026-08-13): DAVANGERE,
 * DHARWAD, TUMKUR, KOLAR and MANDYA came back ~0% fetched on a run whose
 * matrix ran all 34 districts at once — a burst, not a sustained per-file
 * problem, going by every other district succeeding normally. Retry the
 * fetch-and-validate a few times with backoff before giving up, same as a
 * transient HTTP error already gets. */
async function fetchPdfWithRetry(url, tries = 3) {
  let reason;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const buf = await get(url);
      if (buf.subarray(0, 4).toString('latin1') === '%PDF') return buf;
      reason = 'not-pdf (Drive rate limit / permission — returned HTML)';
    } catch (err) {
      reason = `fetch-error: ${(err?.message ?? '').slice(0, 100)}`;
    }
    if (attempt < tries) await sleep(2000 * attempt);
  }
  throw Object.assign(new Error(reason), { reason });
}

function recordFail(district, ac, file, reason) {
  report.failed++;
  const rec = {
    district: district.name,
    acNo: ac?.no ?? file.acNo ?? null,
    partNo: file.partNo ?? null,
    name: file.name || file.partName || '',
    id: file.id || file.zipId || '',
    url: file.url || file.zipUrl || '',
    entry: file.entry || '',
    reason
  };
  report.failedFiles.push(rec);
  log(`  FETCH FAIL: ${rec.district} AC${rec.acNo ?? '?'} part ${rec.partNo ?? '?'} "${rec.name}" [${rec.id || rec.url}${rec.entry ? '#' + rec.entry : ''}] — ${reason}`);
}

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
      const key = fileKey(file);
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
      if (file.zipId || file.zipUrl) {
        // Already-decompressed bytes; `report.bytes` counted the archive once.
        const entry = (await openArchive(file)).get(file.entry);
        if (!entry) throw new Error(`no entry ${file.entry}`);
        buf = entry.read();
      } else {
        buf = await fetchPdfWithRetry(file.url ?? driveDownloadUrl(file.id));
        report.bytes += buf.length;
      }
    } catch (err) {
      recordFail(district, ac, file, err.reason ?? `fetch-error: ${(err?.message ?? '').slice(0, 100)}`);
      return;
    }
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      // Throttling and permission changes come back as an HTML page.
      recordFail(district, ac, file, 'not-pdf (Drive rate limit / permission — returned HTML)');
      return;
    }

    if (looksScanned(buf)) {
      report.scanned++;
      await appendFile(donePath, key + '\n');
      return;
    }

    const { rows, meta } = parseBoothPdf(buf);
    if (!rows.length) report.empty++;

    let payload = '';
    for (const row of rows) {
      if (row.category === 'others' && row.reasonRaw) {
        report.unmappedReasons[row.reasonRaw] = (report.unmappedReasons[row.reasonRaw] ?? 0) + 1;
      }
      // The file name is the first authority on which booth this is, because it
      // is what the folder structure and the newest-copy rule are keyed on. When
      // it carries nothing — Bellary's files are named 17858435222676.pdf — fall
      // back to the section header the ECI printed inside the document. Without
      // this, 1,80,421 Bellary records had no constituency and no booth.
      const { pageAc, pagePart, ...record } = row;
      const acNo = ac.no ?? file.acNo ?? pageAc?.no ?? null;
      payload += JSON.stringify({
        ...record,
        district: district.name,
        acNo,
        acName: (ac.no ?? file.acNo) != null ? ac.name : (pageAc?.name ?? ac.name),
        partNo: file.partNo ?? pagePart?.no ?? null,
        // The file name is only a trustworthy source of the booth *name* when it
        // also yielded a part number. Where it did not, parseBoothName falls back
        // to the bare file name, and for Bellary that is "17858435222676" — which
        // reached the live site as the polling station a voter was told to go to.
        // Prefer the ECI's own name from the page header in that case.
        partName: (file.partNo != null && file.partName) || pagePart?.name || file.partName || '',
        // For a booth that came out of an archive, the citizen's source link is
        // the archive itself — that is what the district actually published.
        fileId: file.id ?? file.zipId ?? '',
        fileUrl: file.url ?? file.zipUrl ?? '',
        // Same fallback: the generation date is in the file name for most
        // districts and only inside the document for the rest.
        generatedOn: file.generatedOn || meta.generatedOn || ''
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
  archives.clear();          // release this district's archive buffers
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
