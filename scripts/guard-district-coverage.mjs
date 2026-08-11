/* Coverage-floor guard — refuse to publish a build where a district's record
 * count collapsed versus the last committed build.
 *
 * The failure this catches: Google Drive throttles the runner mid-import, whole
 * districts download as 0 bytes, and the district lands with a fraction of its
 * electors (Bagalkot 0, Mandya 17k of 168k). Those rows are still > 0, so the
 * "district produced no rows" check waves them through — and the truncated data
 * silently overwrites the good data, telling real voters "not on the list".
 *
 * Three floors, because a throttled import shows up in three shapes:
 *   1. a district present but shrunken   -> per-district DROP_FLOOR (70%)
 *   2. a district that vanished entirely -> caught by iterating the PREVIOUS
 *      build (a disappeared district is absent from the new one, so a loop over
 *      the new build would never look at it — this is exactly how #28 dropped
 *      Bagalkot from 34 districts to 33 unnoticed)
 *   3. many districts each dipping a little -> whole-state STATE_FLOOR (90%)
 *
 * Compares the freshly-built docs/data/stats.json against a snapshot of the
 * PREVIOUS build's stats (PREV_STATS, captured before the rebuild overwrote it).
 * Republishing a booth or two moves a district by well under these thresholds;
 * only a mass fetch failure clears them. Skipped when there is no previous build.
 *
 *   PREV_STATS=/tmp/prev-stats.json node scripts/guard-district-coverage.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DROP_FLOOR = Number(process.env.DROP_FLOOR ?? 0.7); // a district below 70% of last build
export const STATE_FLOOR = Number(process.env.STATE_FLOOR ?? 0.9); // the whole state below 90% of last build

/**
 * Pure assessment so it can be unit-tested without touching the filesystem.
 * Returns { skip } when there is no previous build, otherwise the list of
 * collapsed districts and any whole-state collapse.
 */
export function assessCoverage(prev, cur, { dropFloor = DROP_FLOOR, stateFloor = STATE_FLOOR } = {}) {
  const prevBy = new Map((prev?.districts ?? []).map((d) => [d.name, d.total]));
  if (!prevBy.size) return { skip: true };

  // Iterate the PREVIOUS build's districts, not the new one's, so a district
  // that vanished entirely (absent from cur) is treated as now=0 and caught.
  const curBy = new Map((cur?.districts ?? []).map((d) => [d.name, d.total]));
  const collapsed = [];
  for (const [name, before] of prevBy) {
    if (before > 1000) {
      const now = curBy.get(name) ?? 0;
      if (now < before * dropFloor) {
        collapsed.push({ name, before, now, pct: ((now / before) * 100).toFixed(0), vanished: !curBy.has(name) });
      }
    }
  }

  const prevTotal = prev?.total ?? [...prevBy.values()].reduce((a, b) => a + b, 0);
  const curTotal = cur?.total ?? [...curBy.values()].reduce((a, b) => a + b, 0);
  const stateCollapse = prevTotal > 0 && curTotal < prevTotal * stateFloor
    ? { prevTotal, curTotal, pct: ((curTotal / prevTotal) * 100).toFixed(1) }
    : null;

  return { skip: false, collapsed, stateCollapse, dropFloor, stateFloor, districtsChecked: curBy.size };
}

// ------------------------------------------------------------------- CLI

async function main() {
  const prevPath = process.env.PREV_STATS ?? resolve('/tmp/prev-stats.json');
  const load = async (p) => JSON.parse(await readFile(p, 'utf8').catch(() => '{"districts":[]}'));
  const prev = await load(prevPath);
  const cur = await load(resolve('docs/data/stats.json'));

  const r = assessCoverage(prev, cur);
  if (r.skip) {
    console.log('coverage guard: no previous build to compare against — skipping.');
    process.exit(0);
  }

  if (r.stateCollapse) {
    const { prevTotal, curTotal, pct } = r.stateCollapse;
    console.error(`::error::state total collapsed ${prevTotal} -> ${curTotal} (${pct}% of last build, floor ${(r.stateFloor * 100).toFixed(0)}%) — a partial/throttled import, not real data. Refusing to publish; docs/data is unchanged.`);
    process.exit(1);
  }

  if (r.collapsed.length) {
    console.error(`::error::${r.collapsed.length} district(s) collapsed below ${(r.dropFloor * 100).toFixed(0)}% of the last build — this is a download/extraction failure, not real data. Refusing to publish; docs/data is unchanged. Re-run the import (or, if this is genuinely correct, allow_partial=true).`);
    for (const c of r.collapsed) {
      console.error(`  ${c.name}: ${c.before} -> ${c.now} (${c.pct}%)${c.vanished ? ' [VANISHED — district absent from the new build entirely]' : ''}`);
    }
    process.exit(1);
  }

  console.log(`coverage guard OK: no district fell below ${(r.dropFloor * 100).toFixed(0)}% and the state total held above ${(r.stateFloor * 100).toFixed(0)}% of the last build (${r.districtsChecked} districts checked).`);
}

// Run only when invoked directly, so importing assessCoverage for tests is free.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
