/* Fetch the official constituency list from the ECI's public reference endpoints.
 *
 * Two endpoints on gateway-voters.eci.gov.in serve reference data without
 * authentication — the same lists the portal's own dropdowns are built from:
 *
 *   /api/v1/common/districts/S10     34 Karnataka districts, with district codes
 *   /api/v1/common/acs/<districtCd>   that district's assembly constituencies
 *
 * Everything else on that gateway is 401 and stays that way. Voter search is
 * captcha-gated and encrypted per query; this script does not go near it, and
 * nothing here is per-elector data.
 *
 * Worth having because build-ac-names.mjs reads names out of the booth PDFs, one
 * fetch per constituency, and can only name a constituency that published a
 * readable PDF. This names all 224 in two seconds, and cross-checks the ones we
 * derived ourselves.
 *
 *   node scripts/fetch-ac-names.mjs [--write]
 */

import { resolve } from 'node:path';
import { ROOT, log, readJson, writeJson } from './lib/common.mjs';

const STATE = 'S10';
const BASE = 'https://gateway-voters.eci.gov.in/api/v1/common';
const UA = { 'user-agent': 'Mozilla/5.0', accept: 'application/json' };
const OUT = resolve(ROOT, 'seed', 'ac-names.json');
const MAP = resolve(ROOT, 'seed', 'ac-districts.json');
const write = process.argv.includes('--write');

const districts = await (await fetch(`${BASE}/districts/${STATE}`, { headers: UA })).json();
log(`${districts.length} districts`);

const acs = [];
for (const d of districts) {
  const res = await fetch(`${BASE}/acs/${d.districtCd}`, { headers: UA });
  if (!res.ok) { log(`  ${d.districtValue}: HTTP ${res.status}`); continue; }
  for (const a of await res.json()) {
    acs.push({ no: a.asmblyNo, name: a.asmblyName, district: d.districtValue });
  }
}
acs.sort((a, b) => a.no - b.no);
log(`${acs.length} constituencies\n`);

// Cross-check rather than overwrite: names we read out of the PDFs are what the
// site has been serving, and a silent disagreement between the two sources is
// worth seeing before either is trusted.
const existing = (await readJson(OUT, {})) ?? {};
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');
const differs = [];
const added = [];
const merged = { ...existing };

for (const a of acs) {
  const mine = existing[a.no];
  if (!mine) { added.push(`${a.no} ${a.name}`); merged[a.no] = a.name; continue; }
  if (norm(mine) !== norm(a.name)) differs.push(`${a.no}: ours "${mine}" vs ECI "${a.name}"`);
}

log(`  agree with the names read from the PDFs: ${acs.length - differs.length - added.length}`);
log(`  disagree:                                ${differs.length}`);
for (const d of differs) log(`    ${d}`);
log(`  not previously named:                    ${added.length}`);
for (const a of added) log(`    ${a}`);

if (!write) {
  log('\nNothing written. Re-run with --write to update seed/ac-names.json.');
  process.exit(differs.length ? 1 : 0);
}

await writeJson(OUT, Object.fromEntries(Object.entries(merged).sort((a, b) => +a[0] - +b[0])), true);
await writeJson(MAP, Object.fromEntries(acs.map((a) => [a.no, a.district])), true);
log(`\nWrote ${Object.keys(merged).length} names to ${OUT}`);
log(`Wrote the official constituency→district map to ${MAP}`);
