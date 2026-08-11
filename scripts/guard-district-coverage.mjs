/* Coverage-floor guard — refuse to publish a build where a district's record
 * count collapsed versus the last committed build.
 *
 * The failure this catches: Google Drive throttles the runner mid-import, whole
 * districts download as 0 bytes, and the district lands with a fraction of its
 * electors (Bagalkot 0, Mandya 17k of 168k). Those rows are still > 0, so the
 * "district produced no rows" check waves them through — and the truncated data
 * silently overwrites the good data, telling real voters "not on the list".
 *
 * Compares the freshly-built docs/data/stats.json against a snapshot of the
 * PREVIOUS build's stats (PREV_STATS, captured before the rebuild overwrote it).
 * A drop past the threshold is treated as a download failure, not real data, and
 * exits non-zero so the workflow leaves docs/data unchanged. Republishing a
 * booth or two moves a district by well under this; only a mass fetch failure
 * clears it. Skipped when there is no previous build to compare against.
 *
 *   PREV_STATS=/tmp/prev-stats.json node scripts/guard-district-coverage.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DROP_FLOOR = Number(process.env.DROP_FLOOR ?? 0.7); // refuse below 70% of last build
const prevPath = process.env.PREV_STATS ?? resolve('/tmp/prev-stats.json');

const load = async (p) => JSON.parse(await readFile(p, 'utf8').catch(() => '{"districts":[]}'));

const prev = await load(prevPath);
const cur = await load(resolve('docs/data/stats.json'));

const prevBy = new Map((prev.districts ?? []).map((d) => [d.name, d.total]));
if (!prevBy.size) {
  console.log('coverage guard: no previous build to compare against — skipping.');
  process.exit(0);
}

const collapsed = [];
for (const d of cur.districts ?? []) {
  const before = prevBy.get(d.name);
  if (before && before > 1000 && d.total < before * DROP_FLOOR) {
    collapsed.push({ name: d.name, before, now: d.total, pct: ((d.total / before) * 100).toFixed(0) });
  }
}

if (collapsed.length) {
  console.error(`::error::${collapsed.length} district(s) collapsed below ${(DROP_FLOOR * 100).toFixed(0)}% of the last build — this is a download/extraction failure, not real data. Refusing to publish; docs/data is unchanged. Re-run the import (or, if this is genuinely correct, allow_partial=true).`);
  for (const c of collapsed) console.error(`  ${c.name}: ${c.before} -> ${c.now} (${c.pct}%)`);
  process.exit(1);
}

console.log(`coverage guard OK: no district fell below ${(DROP_FLOOR * 100).toFixed(0)}% of the last build (${cur.districts?.length ?? 0} districts checked).`);
