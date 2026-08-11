/* Tests for the district-collapse guard — the check that refuses to publish a
 * build that lost data versus the last one. Every case below is a shape that a
 * throttled Google Drive import actually produced (or would produce).
 *
 *   node scripts/test-collapse-guard.mjs
 */
import { assessCoverage } from './guard-district-coverage.mjs';
import { log } from './lib/common.mjs';

let passed = 0;
const failures = [];
const check = (name, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { passed++; return; }
  failures.push(`${name}\n      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};

const stats = (total, ds) => ({ total, districts: Object.entries(ds).map(([name, t]) => ({ name, total: t })) });

// No previous build -> nothing to compare, must skip (first import).
check('no previous build -> skip', assessCoverage({ districts: [] }, stats(100, { A: 100 })).skip, true);

// A clean re-import that grows slightly is fine.
{
  const prev = stats(300000, { BAGALKOT: 100000, MANDYA: 120000, HASSAN: 80000 });
  const cur = stats(305000, { BAGALKOT: 101000, MANDYA: 121000, HASSAN: 83000 });
  const r = assessCoverage(prev, cur);
  check('healthy re-import -> no collapse', [r.collapsed.length, r.stateCollapse], [0, null]);
}

// The #28 shape: a whole district vanishes from the new build.
{
  const prev = stats(300000, { BAGALKOT: 100000, MANDYA: 120000, HASSAN: 80000 });
  const cur = stats(200000, { MANDYA: 120000, HASSAN: 80000 });
  const r = assessCoverage(prev, cur);
  check('vanished district is flagged', r.collapsed.map((c) => [c.name, c.vanished]), [['BAGALKOT', true]]);
  check('  and the state floor also trips', !!r.stateCollapse, true);
}

// A small district vanishes but the state total stays above the state floor:
// the per-district vanished check must still catch it on its own.
{
  const prev = stats(300000, { BIG_A: 250000, BIG_B: 40000, SMALL_C: 10000 });
  const cur = stats(290000, { BIG_A: 250000, BIG_B: 40000 });
  const r = assessCoverage(prev, cur);
  check('small vanish caught even when state floor passes',
    [r.stateCollapse, r.collapsed.map((c) => c.name)], [null, ['SMALL_C']]);
}

// Many districts each dip a little: no single one trips 70%, but the state total
// falls below 90% — only the whole-state floor catches this.
{
  const prev = stats(300000, { A: 100000, B: 120000, C: 80000 });
  const cur = stats(240000, { A: 80000, B: 96000, C: 64000 });
  const r = assessCoverage(prev, cur);
  check('broad dip caught by state floor', [r.collapsed.length, r.stateCollapse?.pct], [0, '80.0']);
}

// A district shrinking below 70% (present, not vanished) is a per-district trip.
{
  const prev = stats(300000, { A: 100000, B: 120000, C: 80000 });
  const cur = stats(280000, { A: 60000, B: 120000, C: 80000 }); // A: 60% ; state 93%
  const r = assessCoverage(prev, cur);
  check('shrunken district (not vanished) is a per-district trip',
    r.collapsed.map((c) => [c.name, c.vanished]), [['A', false]]);
}

// Small districts (<= 1000) are exempt — a pilot/edge district going to zero is
// not a throttling signal and must not block a real statewide publish.
{
  const prev = stats(301000, { A: 150000, B: 150000, TINY: 1000 });
  const cur = stats(300000, { A: 150000, B: 150000 });
  const r = assessCoverage(prev, cur);
  check('sub-1000 district is exempt from the per-district floor', r.collapsed.length, 0);
}

if (failures.length) {
  log(`\nFAILED — ${failures.length} of ${passed + failures.length} checks:`);
  for (const f of failures) log(`  x ${f}`);
  process.exit(1);
}
log(`PASSED — ${passed} checks.`);
