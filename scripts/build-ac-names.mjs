/* Build seed/ac-names.json — the official assembly-constituency names.
 *
 * Folder names on Drive are the only place discover can learn a constituency's
 * name, and for 79 of 207 they are not AC-shaped, leaving cards and filters
 * reading "AC 167". But every booth PDF prints the authoritative line itself:
 *
 *     AC: 209-Virajpet; Part: 100-Govt Higher primary School, Halugunda
 *
 * written by the ECI's own generator. So fetch one PDF per constituency and read
 * the name out of it. One pass, ~210 small files, and the result is committed so
 * no future import has to repeat it.
 *
 * Note this numbering is the ECI's, and is NOT the numbering in the CEO's
 * ac_names.csv (which has Virajpet at 126, not 209). Do not mix them.
 *
 *   node scripts/build-ac-names.mjs [--all]
 *
 * Without --all, only constituencies missing a real name are fetched.
 */

import { resolve } from 'node:path';
import { CACHE, ROOT, driveDownloadUrl, get, log, pool, progress, readJson, writeJson } from './lib/common.mjs';
import { parseBoothPdf } from './lib/pdf.mjs';
import { parseBoothName } from './lib/naming.mjs';

const OUT = resolve(ROOT, 'seed', 'ac-names.json');
const all = process.argv.includes('--all');

const manifest = await readJson(resolve(CACHE, 'manifest.json'));
if (!manifest) {
  log('No cache/manifest.json. Run `npm run discover` first.');
  process.exit(1);
}

const existing = (await readJson(OUT, {})) ?? {};

// One representative file per AC number.
const targets = new Map();
for (const district of manifest.districts) {
  for (const ac of district.acs) {
    for (const file of ac.files) {
      // Re-read the file name with the current parser rather than trusting the
      // acNo the manifest was built with: a manifest crawled before a naming
      // variant was recognised has null there, and those are exactly the
      // constituencies whose names are missing.
      const no = parseBoothName(file.name).acNo ?? file.acNo ?? ac.no;
      if (no == null) continue;
      // Skip only what we already have a PDF-derived name for. A folder name
      // that merely looks plausible is not a reason to skip: "07-2026" and
      // "BGD FINAL" are date folders, and "BGM Rural" is an abbreviation, none
      // of which is the constituency's name.
      if (!all && existing[no]) continue;
      if (!targets.has(no)) targets.set(no, { no, file, district: district.name });
    }
  }
}

const jobs = [...targets.values()];
log(`${jobs.length} constituencies to identify${all ? ' (--all)' : ' (missing names only)'}`);
if (!jobs.length) {
  log('Nothing to do.');
  process.exit(0);
}

const found = { ...existing };
let ok = 0;
let failed = 0;

await pool(jobs, 6, async (job) => {
  let buf;
  try {
    buf = await get(job.file.url ?? driveDownloadUrl(job.file.id), { tries: 2, timeoutMs: 45000 });
  } catch {
    failed++;
    return;
  }
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
    failed++;
    return;
  }
  const { meta } = parseBoothPdf(buf);
  // "AC: 209-Virajpet; Part: 100-Govt Higher primary School, Halugunda"
  const m = /AC:\s*(\d{1,3})\s*-\s*([^;]+)/i.exec(meta.acLine ?? '');
  if (!m) {
    failed++;
    return;
  }
  const no = +m[1];
  const name = m[2].replace(/\s+/g, ' ').trim();
  if (name) {
    found[no] = name;
    ok++;
    // The PDF's own number is authoritative; flag a mismatch rather than hide it.
    if (no !== job.no) log(`\n  note: file filed under AC ${job.no} reports AC ${no} (${name})`);
  }
}, (n, total) => progress(`  ${n}/${total}  identified ${ok}  failed ${failed}`));

progress('');
const sorted = Object.fromEntries(
  Object.entries(found).sort((a, b) => +a[0] - +b[0])
);
await writeJson(OUT, sorted, true);
log(`\n${Object.keys(sorted).length} constituency names in ${OUT}`);
log(`  identified this run: ${ok}   failed: ${failed}`);
