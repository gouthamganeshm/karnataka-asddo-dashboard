/* Stage 3 — PDFs to rows. Writes one NDJSON file per district so the full
   state never has to fit in memory at once, and so a district can be
   re-extracted on its own after a data correction. */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CACHE, log, progress, readJson, writeJson } from './lib/common.mjs';
import { categorise, looksScanned, parseBoothPdf } from './lib/pdf.mjs';

const PDF_DIR = resolve(CACHE, 'pdfs');
const OUT_DIR = resolve(CACHE, 'extracted');
const args = process.argv.slice(2);
const only = argValue('--district')?.split(',').map((s) => s.trim().toUpperCase());

function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

const manifest = await readJson(resolve(CACHE, 'manifest.json'));
if (!manifest) {
  log('No manifest. Run `npm run discover` first.');
  process.exit(1);
}
await mkdir(OUT_DIR, { recursive: true });

const report = {
  files: 0, missing: 0, scanned: 0, empty: 0, rows: 0,
  unmappedReasons: {}, byDistrict: {}
};

for (const district of manifest.districts) {
  if (only && !only.some((o) => district.name.includes(o))) continue;

  const outPath = resolve(OUT_DIR, `${slug(district.name)}.ndjson`);
  const out = createWriteStream(outPath, { encoding: 'utf8' });
  let districtRows = 0;
  let processed = 0;
  const total = district.acs.reduce((n, ac) => n + ac.files.length, 0);

  for (const ac of district.acs) {
    for (const file of ac.files) {
      processed++;
      report.files++;
      let buf;
      try {
        buf = await readFile(resolve(PDF_DIR, `${file.id}.pdf`));
      } catch {
        report.missing++;
        continue;
      }

      if (looksScanned(buf)) {
        report.scanned++;
        continue;
      }

      const { rows } = parseBoothPdf(buf);
      if (!rows.length) {
        // A booth with no deletions is normal; a booth we failed to parse is not.
        report.empty++;
      }

      for (const row of rows) {
        // Track prose we did not recognise so new wording is noticed, not lost.
        if (row.category === 'others' && row.reasonRaw) {
          report.unmappedReasons[row.reasonRaw] =
            (report.unmappedReasons[row.reasonRaw] ?? 0) + 1;
        }
        out.write(
          JSON.stringify({
            ...row,
            district: district.name,
            acNo: ac.no ?? file.acNo ?? null,
            acName: ac.name,
            partNo: file.partNo ?? null,
            partName: file.partName ?? '',
            fileId: file.id,
            generatedOn: file.generatedOn ?? ''
          }) + '\n'
        );
        districtRows++;
      }

      if (processed % 20 === 0 || processed === total) {
        progress(`  ${district.name}: ${processed}/${total} PDFs, ${districtRows} rows`);
      }
    }
  }

  await new Promise((r) => out.end(r));
  progress('');
  log(`${district.name}: ${districtRows} rows from ${total} PDFs -> ${outPath}`);
  report.rows += districtRows;
  report.byDistrict[district.name] = districtRows;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// `others` should be a small residue. If it is large, the mapping needs work.
const unmapped = Object.entries(report.unmappedReasons).sort((a, b) => b[1] - a[1]);
await writeJson(resolve(CACHE, 'extract-report.json'), { ...report, unmappedReasons: unmapped }, true);

log(`\n${report.rows} rows from ${report.files} PDFs`);
log(`  missing from cache: ${report.missing}   scanned (unreadable): ${report.scanned}   no rows: ${report.empty}`);
if (unmapped.length) {
  log(`\n  Reason strings that fell through to "others" (top 10):`);
  for (const [reason, n] of unmapped.slice(0, 10)) log(`    ${String(n).padStart(7)}  ${reason}`);
  log('  Add patterns to categorise() in scripts/lib/pdf.mjs if any of these belong in A/S/D/D.');
}
