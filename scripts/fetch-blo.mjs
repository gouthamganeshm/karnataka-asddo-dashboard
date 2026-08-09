/* Fetch the Booth Level Officer directory from Karnataka's own election GIS.
 *
 * Source: kgis.ksrsac.in — the Karnataka State Remote Sensing Applications
 * Centre, the state government's GIS body. Its public officers-list page
 * (election/officerslist.aspx) is backed by an ASP.NET web method that needs no
 * authentication, no token and no captcha:
 *
 *   POST Election.asmx/GetBLODetails  {op_lvl:'ASBLY_CSTNY_ID', aoi_code:<acNo>}
 *   -> [{ ACName, POLIN_BOOTH_ID_New, BLO_Name, BLO_Mob, POLIN_STATN_NAME_New }]
 *
 * This is the same reference data the page's own dropdowns consume. It is the
 * information the government publishes so a citizen can reach their BLO, and
 * POLIN_BOOTH_ID_New is this project's partNo, so it joins to a record by
 * (constituency, part).
 *
 * One pass over the 224 constituencies, written to seed/blo.json. Static after
 * that — re-run only to refresh, since BLO assignments change during a revision.
 *
 *   node scripts/fetch-blo.mjs
 */

import { resolve } from 'node:path';
import { ROOT, log, progress, pool, writeJson } from './lib/common.mjs';

const ENDPOINT = 'https://kgis.ksrsac.in/election/Election.asmx/GetBLODetails';
const OUT = resolve(ROOT, 'seed', 'blo.json');
const AC_COUNT = 224;

async function blosFor(acNo) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': 'Mozilla/5.0' },
    body: JSON.stringify({ op_lvl: 'ASBLY_CSTNY_ID', aoi_code: String(acNo) })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = JSON.parse((await res.json()).d);
  const clean10 = (s) => (String(s ?? '').match(/\d/g) ?? []).join('').slice(-10);
  const out = {};
  for (const r of rows) {
    const part = Number(r.POLIN_BOOTH_ID_New);
    const name = (r.BLO_Name ?? '').replace(/\s+/g, ' ').trim();
    const mob = clean10(r.BLO_Mob);
    if (!Number.isFinite(part) || (!name && !mob)) continue;
    // A booth can appear more than once; keep the first non-empty.
    if (!out[part]) out[part] = { name, mobile: mob.length === 10 ? mob : '' };
  }
  return out;
}

const acNos = Array.from({ length: AC_COUNT }, (_, i) => i + 1);
const byAc = {};
let ok = 0;
let booths = 0;
let failed = [];

await pool(acNos, 6, async (acNo) => {
  try {
    const b = await blosFor(acNo);
    const n = Object.keys(b).length;
    if (n) { byAc[acNo] = b; ok++; booths += n; }
  } catch (e) {
    failed.push(`${acNo} (${e.message})`);
  }
  progress(`  ${ok}/${AC_COUNT} constituencies · ${booths} booths`);
});
progress('');

await writeJson(OUT, byAc, true);
const withMob = Object.values(byAc).flatMap((a) => Object.values(a)).filter((b) => b.mobile).length;
log(`Wrote ${ok} constituencies, ${booths} booths to ${OUT}`);
log(`  ${withMob} of ${booths} have a 10-digit mobile (${((withMob / booths) * 100).toFixed(1)}%)`);
if (failed.length) log(`  ${failed.length} constituencies failed: ${failed.slice(0, 10).join(', ')}`);
