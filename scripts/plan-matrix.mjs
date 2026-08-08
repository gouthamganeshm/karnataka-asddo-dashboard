/* Plan the import matrix, and refuse to plan one that has silently lost a district.
 *
 * This lived as an inline script inside import.yml, which is how it went wrong:
 * it filtered out districts that yielded no booth PDFs, every later check
 * compared against the filtered number, and an import that had already dropped
 * Vijayanagara and Bangalore Rural still reported "all districts imported".
 * Both were missing from the live site for weeks without one red mark anywhere.
 *
 * A guard nobody can run is not a guard, so it is a file now, with tests.
 *
 *   node scripts/plan-matrix.mjs [--manifest path] [--allow-partial]
 *
 * Writes matrix/total/districts/source_districts/empty to GITHUB_OUTPUT when
 * that is set; always prints a summary. Exits 1 if any district on the source
 * page yielded nothing, unless --allow-partial.
 */

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE, log, readJson } from './lib/common.mjs';

const args = process.argv.slice(2);
const argValue = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };

const manifestPath = argValue('--manifest') ?? resolve(CACHE, 'manifest.json');
const allowPartial = args.includes('--allow-partial') || process.env.ALLOW_PARTIAL === 'true';

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const boothCount = (d) => d.acs.reduce((n, ac) => n + ac.files.length, 0);

/** The decision, separated from the I/O so a test can call it directly. */
export function plan(manifest, { allowPartial = false } = {}) {
  const districts = manifest.districts
    .filter((d) => boothCount(d) > 0)
    .map((d) => ({ name: d.name, slug: slug(d.name), booths: boothCount(d) }))
    // Longest first: the slowest district starts earliest, which shortens the
    // whole matrix.
    .sort((a, b) => b.booths - a.booths);

  const empty = manifest.districts.filter((d) => boothCount(d) === 0).map((d) => d.name);

  return {
    districts,
    empty,
    total: districts.reduce((n, d) => n + d.booths, 0),
    sourceDistricts: manifest.districts.length,
    ok: empty.length === 0 || allowPartial,
    blocked: empty.length > 0 && !allowPartial
  };
}

// --------------------------------------------------------------------- run

// Run directly, not when imported by the tests. Compared as filesystem paths:
// on Windows `file://${argv[1]}` is a slash short of import.meta.url, so the
// obvious string comparison silently never matches and the script does nothing.
if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const manifest = await readJson(manifestPath);
  if (!manifest) {
    log(`::error::No manifest at ${manifestPath}`);
    process.exit(1);
  }

  const result = plan(manifest, { allowPartial });

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `matrix=${JSON.stringify({ include: result.districts })}\n` +
      `total=${result.total}\n` +
      `districts=${result.districts.length}\n` +
      `source_districts=${result.sourceDistricts}\n` +
      `empty=${result.empty.join(', ')}\n`);
  }

  log(`${result.districts.length} of ${result.sourceDistricts} districts, ${result.total} booth PDFs`);
  for (const note of manifest.coverage?.unreadable ?? []) log(`::warning::unreadable source: ${note}`);

  if (!result.empty.length) process.exit(0);

  // A visitor from a district we never imported reads "not on the deleted list"
  // as an all-clear. Narrowing coverage has to be a deliberate choice, not a
  // side effect of a crawl that came up short.
  const msg = `${result.empty.length} of ${result.sourceDistricts} districts on the source page ` +
              `yielded no booth PDFs: ${result.empty.join(', ')}.`;
  if (allowPartial) {
    log(`::warning::${msg} Continuing because allow_partial=true.`);
    process.exit(0);
  }
  log(`::error::${msg} Fix the crawl, or re-run with allow_partial=true to import without them.`);
  process.exit(1);
}
