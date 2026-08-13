/* Self-healing standing retry list — the part of "never needs a human to
 * notice and pass --district" that closes the loop after a run.
 *
 * Two failure modes leave a district's data stale without failing the build:
 *   1. short crawl (plan-incremental.mjs): fewer constituencies than expected,
 *      preserved from live untouched.
 *   2. collapse on fetch (3b-merge-build.mjs): full constituency count, but
 *      the actual PDF fetch mostly failed (Drive throttling), so fresh rows
 *      came back far below live — preserved from live untouched.
 * Both are SAFE (old data kept, nothing published broken) but SILENT: nothing
 * else in the pipeline retries them without a human noticing and forcing a
 * re-run. This script is that notice-and-retry, automated: it reads what
 * happened THIS run from cache/change-report.json (short) and
 * cache/merge-report.json (collapsed), and updates seed/force-pull.json — the
 * list plan-incremental.mjs auto-forces on every future run, scheduled or
 * manual — so a district stays force-retried until a run actually lands fresh
 * data for it, then drops back out on its own.
 *
 * Run at the end of the build job, after the merge, before the data commit
 * (seed/force-pull.json should be committed in the same commit as the data
 * it describes).
 *
 *   node scripts/update-force-pull.mjs
 */
import { resolve } from 'node:path';
import { CACHE, ROOT, log, readJson, writeJson } from './lib/common.mjs';

const FORCE_PULL_PATH = resolve(ROOT, 'seed', 'force-pull.json');
const today = new Date().toISOString().slice(0, 10);

const current = (await readJson(FORCE_PULL_PATH, {})) ?? {};
const changeReport = await readJson(resolve(CACHE, 'change-report.json'), null);
const mergeReport = await readJson(resolve(CACHE, 'merge-report.json'), null);

if (!changeReport && !mergeReport) {
  log('update-force-pull: neither change-report.json nor merge-report.json present this run — nothing to update, leaving seed/force-pull.json as-is.');
  process.exit(0);
}

// Districts this run found still broken, with why.
const stillBad = new Map(); // name -> reason
for (const s of changeReport?.preservedShort ?? []) stillBad.set(s.name, `short crawl (${s.got}/${s.exp} constituencies)`);
for (const s of changeReport?.forcedShort ?? []) stillBad.set(s.name, `short crawl (${s.got}/${s.exp} constituencies), forced through`);
for (const d of mergeReport?.demotedDetail ?? []) stillBad.set(d.district, `collapsed on fetch (${d.fresh}/${d.live} = ${((d.fresh / d.live) * 100).toFixed(0)}% of live)`);

// Districts this run actually landed fresh, healthy data for — proof of healing.
const healed = new Set(mergeReport?.refreshed ?? []);

const next = { ...current };
const added = [], bumped = [], removed = [], stillStuck = [];

for (const [name, reason] of stillBad) {
  if (next[name]) {
    next[name] = { ...next[name], reason, attempts: next[name].attempts + 1, lastSeen: today };
    bumped.push(name);
  } else {
    next[name] = { reason, attempts: 1, since: today, lastSeen: today };
    added.push(name);
  }
}

for (const name of Object.keys(current)) {
  if (stillBad.has(name)) continue; // handled above
  if (healed.has(name)) { delete next[name]; removed.push(name); }
  else if (next[name]) stillStuck.push(name); // in the list but not touched this run — leave as-is
}

await writeJson(FORCE_PULL_PATH, next, true);

if (added.length) log(`force-pull: NEW — ${added.join(', ')}`);
if (bumped.length) log(`force-pull: still stuck, retried again — ${bumped.map((n) => `${n} (attempt ${next[n].attempts})`).join(', ')}`);
if (removed.length) log(`force-pull: HEALED, dropped from the standing retry list — ${removed.join(', ')}`);
if (!added.length && !bumped.length && !removed.length) log('force-pull: no change.');
const remaining = Object.keys(next);
log(`force-pull: ${remaining.length} district(s) on the standing retry list${remaining.length ? ` — ${remaining.join(', ')}` : ''}.`);
