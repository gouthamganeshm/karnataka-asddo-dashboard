/* Scan the built buckets for deletions recorded as "death" at a young age.
 *
 * Why this is worth asking: an elector must be 18 to be on the roll at all, so
 * the whole under-20 band is 18- and 19-year-olds. A death there is possible but
 * rare — India's death rate at 18-19 is roughly 0.6 per 1000 per year — so an
 * unusually large count is a data-quality signal about the SIR, not a demographic
 * fact. Anything with age < 18 is impossible outright and can only be an error.
 *
 * Reads docs/data only. No network, no EPICs (the buckets never store them).
 *
 *   node scripts/query-young-deaths.mjs [--max-age 20] [--out path.csv]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOCS, log, progress, readJson } from './lib/common.mjs';
import { categorise } from './lib/pdf.mjs';

const args = process.argv.slice(2);
const argValue = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const MAX_AGE = Number(argValue('--max-age') ?? 20);
const OUT_CSV = argValue('--out') ?? resolve(DOCS, '..', 'young-deaths.csv');

const OUT = resolve(DOCS, 'data');
const built = await readJson(resolve(OUT, 'manifest.json'));
const bucketPath = (p) => (p.length > 2 ? `${p.slice(0, 2)}/${p.slice(2)}` : p);

const { districts, acs, reasons, relations } = built.dicts;

// Reason strings are deduplicated into a dictionary, so categorise each one once
// rather than once per record.
const reasonIsDeath = reasons.map((r) => categorise(r) === 'death');

const partsByAc = new Map();
for (let i = 0; i < acs.length; i++) {
  const p = await readJson(resolve(OUT, 'parts', `${i}.json`), null);
  if (p) partsByAc.set(i, p);
}

const hits = [];
const byAge = new Map();
const byDistrict = new Map();
let scanned = 0;
let deaths = 0;

for (let n = 0; n < 16 ** built.shardDepth; n++) {
  const prefix = n.toString(16).padStart(built.shardDepth, '0');
  let body;
  try {
    body = await readFile(resolve(OUT, 'asddo', `${bucketPath(prefix)}.json`), 'utf8');
  } catch { continue; }

  for (const rec of JSON.parse(body)) {
    const [, name, relative, relIdx, age, serial, reasonIdx, acIdx, fileIdx] = rec;
    scanned++;
    if (!reasonIsDeath[reasonIdx]) continue;
    deaths++;
    if (!age || age >= MAX_AGE) continue;

    const [acNo, acName, distIdx] = acs[acIdx] ?? [];
    const district = districts[distIdx] ?? '?';
    const src = partsByAc.get(acIdx)?.[fileIdx] ?? [];

    hits.push({
      name,
      age,
      relation: relations[relIdx] ?? '',
      relative,
      district,
      acNo: acNo ?? '',
      acName: acName ?? '',
      partNo: src[1] ?? '',
      booth: src[2] ?? '',
      serial,
      reason: reasons[reasonIdx] ?? '',
      source: src[0] ? `https://drive.google.com/file/d/${src[0]}/view` : ''
    });
    byAge.set(age, (byAge.get(age) ?? 0) + 1);
    byDistrict.set(district, (byDistrict.get(district) ?? 0) + 1);
  }
  if (n % 4096 === 0) progress(`  ${scanned.toLocaleString()} records scanned, ${hits.length} hits`);
}
progress('');

hits.sort((a, b) => a.age - b.age || a.district.localeCompare(b.district) || a.name.localeCompare(b.name));

const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const header = ['name', 'age', 'relation', 'relative', 'district', 'acNo', 'acName', 'partNo', 'booth', 'serial', 'reason', 'source'];
await writeFile(OUT_CSV, [header.join(','), ...hits.map((h) => header.map((k) => q(h[k])).join(','))].join('\n') + '\n', 'utf8');

log(`\nScanned ${scanned.toLocaleString()} records · ${deaths.toLocaleString()} recorded as death`);
log(`Under ${MAX_AGE}: ${hits.length.toLocaleString()} (${((hits.length / deaths) * 100).toFixed(3)}% of deaths)\n`);

log('By age:');
for (const age of [...byAge.keys()].sort((a, b) => a - b)) log(`  ${String(age).padStart(3)}  ${byAge.get(age)}`);

log('\nBy district:');
for (const [d, c] of [...byDistrict].sort((a, b) => b[1] - a[1])) log(`  ${String(c).padStart(4)}  ${d}`);

log(`\nWritten to ${OUT_CSV}`);
