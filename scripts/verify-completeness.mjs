/* Per-constituency completeness audit — the "not one voter missed" double-check.
 *
 * verify-build.mjs proves the BUILT data matches what was EXTRACTED. It cannot
 * prove that what was extracted covers the whole source: a booth that failed to
 * download from Drive was never extracted, so its voters are simply absent and
 * every downstream check still passes. This closes that gap.
 *
 * For every constituency of every district it compares the booths on the source
 * page (the manifest) against the resume ledger <slug>.done, using the SAME
 * identity key 2-extract writes there. Only successfully completed booths land in
 * .done (failures are left out so they retry), so a manifest booth absent from
 * .done was never fetched — its electors would be missing from the site.
 *
 * Reports every constituency's booth coverage; exits non-zero on ANY gap so the
 * build refuses to publish, unless ALLOW_PARTIAL is set for a deliberate partial.
 *
 * --district limits the audit to one or more districts (comma-separated), same
 * as 1-discover.mjs / 2-extract.mjs — the import workflow's extract job pulls
 * districts as a matrix, one runner per district, and only that runner's own
 * .done ledger exists on it. Running unscoped there would read every OTHER
 * matrix district as 100% missing, since their .done files live on different
 * runners. Omit --district for a full local run (after `npm run extract` with
 * no --district), where every district's ledger is present on the one machine.
 *
 *   ALLOW_PARTIAL=false node scripts/verify-completeness.mjs
 *   node scripts/verify-completeness.mjs --district KODAGU
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CACHE, log } from './lib/common.mjs';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Must match scripts/2-extract.mjs fileKey() exactly, or a booth looks "missing".
const fileKey = (f) => (f.zipId || f.zipUrl) ? `${f.zipId ?? f.zipUrl}#${f.entry}` : (f.id ?? f.url);

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
};
const only = argValue('--district')?.split(',').map((s) => s.trim().toUpperCase());

const manifest = JSON.parse(await readFile(resolve(CACHE, 'manifest.json'), 'utf8'));
const allowPartial = process.env.ALLOW_PARTIAL === 'true';

let expectedTotal = 0, fetchedTotal = 0, acCount = 0;
const gaps = [];              // constituencies missing at least one booth
const districts = only ? (manifest.districts ?? []).filter((d) => only.some((o) => d.name.includes(o))) : (manifest.districts ?? []);
for (const d of districts) {
  const donePath = resolve(CACHE, 'extracted', `${slug(d.name)}.done`);
  const done = new Set((await readFile(donePath, 'utf8').catch(() => '')).split('\n').filter(Boolean));
  for (const ac of d.acs ?? []) {
    acCount++;
    const expected = (ac.files ?? []).map(fileKey).filter(Boolean);
    const missing = expected.filter((k) => !done.has(k));
    expectedTotal += expected.length;
    fetchedTotal += expected.length - missing.length;
    if (missing.length) gaps.push({ district: d.name, acNo: ac.no, acName: ac.name ?? '', missing: missing.length, expected: expected.length });
  }
}

log(`Completeness audit${only ? ` (${districts.map((d) => d.name).join(', ')})` : ''}: ${fetchedTotal}/${expectedTotal} booths fetched across ${acCount} constituencies in ${districts.length} district(s).`);

if (!gaps.length) {
  log('  Every constituency is complete — no booth on the source page was left unfetched.');
  process.exit(0);
}

gaps.sort((a, b) => b.missing - a.missing);
log(`::${allowPartial ? 'warning' : 'error'}::${gaps.length} constituenc(ies) are missing booths — a silent download failure would drop those electors:`);
for (const g of gaps) log(`  ${g.district} · AC ${g.acNo} ${g.acName}: ${g.missing}/${g.expected} booths NOT fetched`);

if (allowPartial) {
  log('  Continuing because allow_partial=true (deliberate partial publish).');
  process.exit(0);
}
log('  docs/data is unchanged. Re-run: the extract retries failed booths and skips completed ones, so a re-run fills the gaps.');
process.exit(1);
