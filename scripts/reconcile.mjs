/* Reconcile the published data against the CEO's own ASDDO totals.
 *
 * Every other check in this project compares the site to the booth PDFs, which
 * means a document the crawl never found is invisible to all of them. That is
 * not hypothetical: 92-Siruguppa's 32,153 records were missing for weeks while
 * verify-build reported zero problems, because the built data faithfully matched
 * the rows we had.
 *
 * The CEO publishes its own count of electors marked ASDDO, per district, in the
 * daily press release. It is derived from their systems rather than from the
 * PDFs, so it is the only figure here that can say "you are missing a district".
 *
 *   node scripts/reconcile.mjs [--tolerance 2] [--data docs/data]
 *
 * Exits non-zero when a district is off by more than the tolerance, so it can
 * gate an import. Expect small differences in both directions: the press release
 * is a snapshot at one moment and the booth PDFs are regenerated daily.
 */

import { resolve } from 'node:path';
import { CACHE, DOCS, ROOT, log, readJson } from './lib/common.mjs';

const args = process.argv.slice(2);
const argValue = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const TOLERANCE = Number(argValue('--tolerance') ?? 2);   // percent

const official = await readJson(resolve(ROOT, 'seed', 'official-asddo.json'));
// The age of a district's own lists, when the manifest is to hand. It explains
// most of the shortfalls: the CEO's count is current, while a district that last
// published on 27 July is compared against a figure that has grown since.
const manifest = await readJson(resolve(CACHE, 'manifest.json'), null);
const listDate = new Map();
for (const d of manifest?.districts ?? []) {
  const times = [];
  for (const ac of d.acs) for (const f of ac.files) {
    if (!f.generatedOn) continue;
    const [dd, mm, yy] = f.generatedOn.split('/').map(Number);
    if (dd && mm && yy) times.push(Date.UTC(yy, mm - 1, dd));
  }
  if (!times.length) continue;
  times.sort((a, b) => a - b);
  listDate.set(d.name, new Date(times[Math.floor(times.length / 2)]).toISOString().slice(0, 10));
}
const stats = await readJson(resolve(argValue('--data') ? resolve(argValue('--data')) : resolve(DOCS, 'data'), 'stats.json'));
if (!official || !stats) { log('Need seed/official-asddo.json and built stats.json.'); process.exit(1); }

const fmt = (n) => n.toLocaleString('en-IN');
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);

// Names differ in case and spacing between the two sources.
const norm = (s) => s.toUpperCase().replace(/[^A-Z]/g, '');
const ours = new Map(stats.districts.map((d) => [norm(d.name), d.total]));

log(`Official ASDDO totals as on ${official.asOf} (CEO daily press release)`);
log(`Published data: ${fmt(stats.total)} records\n`);

const rows = [];
for (const [name, expected] of Object.entries(official.districts)) {
  const got = ours.get(norm(name)) ?? 0;
  rows.push({ name, expected, got, diff: got - expected, pct: pct(got, expected), asOf: listDate.get(name) ?? '' });
}
rows.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));

log(`  official count is as on ${official.asOf}; "lists" is the median generation date of that district's own documents
`);
log('  district                 official      ours         diff       %   lists');
for (const r of rows) {
  const flag = Math.abs(r.pct) > TOLERANCE ? '  <<<' : '';
  log(`  ${r.name.padEnd(20)} ${fmt(r.expected).padStart(11)} ${fmt(r.got).padStart(11)} ` +
      `${(r.diff >= 0 ? '+' : '') + fmt(r.diff)}`.padStart(12) +
      ` ${r.pct.toFixed(1).padStart(7)}%  ${r.asOf.slice(5)}${flag}`);
}

const stateDiff = stats.total - official.state.asddo;
log('');
log(`  STATE                ${fmt(official.state.asddo).padStart(11)} ${fmt(stats.total).padStart(11)} ` +
    `${(stateDiff >= 0 ? '+' : '') + fmt(stateDiff)}`.padStart(12) +
    ` ${pct(stats.total, official.state.asddo).toFixed(1).padStart(7)}%`);

// Categories are a second, independent signal: the totals can reconcile while
// reasons are being filed under the wrong heading.
log('\n  category      official        ours         diff');
const byCat = stats.byCategory ?? {};
for (const [cat, expected] of Object.entries(official.state.categories)) {
  const got = byCat[cat] ?? 0;
  log(`  ${cat.padEnd(12)} ${fmt(expected).padStart(10)} ${fmt(got).padStart(11)} ` +
      `${(got - expected >= 0 ? '+' : '') + fmt(got - expected)}`.padStart(12));
}

const off = rows.filter((r) => Math.abs(r.pct) > TOLERANCE);
if (off.length) {
  log(`\n${off.length} district(s) differ from the CEO's count by more than ${TOLERANCE}%:`);
  for (const r of off) {
    log(`  ${r.name}: ${fmt(r.got)} vs ${fmt(r.expected)} (${r.pct > 0 ? 'more' : 'fewer'} by ${fmt(Math.abs(r.diff))})`);
  }
  log('\nA shortfall means documents the crawl has not found or cannot read.');
  log('An excess means records counted twice, or filed under the wrong district.');
  process.exit(1);
}
log('\nEvery district is within tolerance of the official count.');
