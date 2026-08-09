/* Tests for the coverage guard — the check that decides whether an import is
 * allowed to publish a narrower set of districts than the source page lists.
 *
 * This exists because the previous version of that check was inline YAML,
 * so nothing could exercise it, and it happily passed an import that had lost
 * two districts. Every case below is one that actually occurred.
 *
 *   node scripts/test-coverage-guard.mjs
 */

import { plan } from './plan-matrix.mjs';
import { isNotBoothList, parseBoothName } from './lib/naming.mjs';
import { listZipEntries, looksZip } from './lib/zip.mjs';
import { deflateRawSync } from 'node:zlib';
import { log } from './lib/common.mjs';

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failures.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}

const district = (name, booths) => ({
  name,
  acs: booths ? [{ no: 1, name: 'x', files: Array.from({ length: booths }, (_, i) => ({ partNo: i })) }] : []
});

// ---------------------------------------------------------------- the guard

{
  const m = { districts: [district('A', 10), district('B', 5)] };
  const r = plan(m);
  check('all districts have data -> not blocked', r.blocked, false);
  check('  matrix is longest-first', r.districts.map((d) => d.name), ['A', 'B']);
  check('  booth total', r.total, 15);
}

{
  // Exactly the shape that shipped: two districts on the source page yielding
  // nothing. The old check counted 2 of 2 and passed.
  const m = { districts: [district('A', 10), district('VIJAYANAGARA', 0), district('BANGALORE RURAL', 0)] };
  const r = plan(m);
  check('empty districts -> blocked', r.blocked, true);
  check('  named, not just counted', r.empty, ['VIJAYANAGARA', 'BANGALORE RURAL']);
  check('  source count is the source count', r.sourceDistricts, 3);
  check('  planned count excludes them', r.districts.length, 1);
}

{
  const m = { districts: [district('A', 10), district('B', 0)] };
  check('allow_partial lets it through', plan(m, { allowPartial: true }).blocked, false);
  check('  but still reports the gap', plan(m, { allowPartial: true }).empty, ['B']);
}

{
  // A district whose constituencies exist but hold no files is still empty.
  const m = { districts: [{ name: 'A', acs: [{ no: 1, name: 'x', files: [] }] }] };
  check('constituencies without files count as empty', plan(m).empty, ['A']);
}

// ------------------------------------------------------- archive discovery

{
  // A minimal zip built here rather than fetched, so the test needs no network.
  const body = Buffer.from('%PDF-1.4 not really a pdf');
  const deflated = deflateRawSync(body);
  const nameBuf = Buffer.from('taluk/S10_90_7_Some School_03_08_2026_21_05_20.pdf');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);

  const localPart = Buffer.concat([local, nameBuf, deflated]);
  const centralPart = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);

  const zip = Buffer.concat([localPart, centralPart, eocd]);

  check('a zip is recognised', looksZip(zip), true);
  const entries = listZipEntries(zip);
  check('  one entry listed', entries.length, 1);
  check('  entry inflates to the original bytes', entries[0].read().toString(), body.toString());

  const parsed = parseBoothName(entries[0].name.split('/').pop());
  check('  booth identity comes from the name inside', [parsed.acNo, parsed.partNo], [90, 7]);
}

check('a PDF is not mistaken for a zip', looksZip(Buffer.from('%PDF-1.7 ....')), false);
check('judgements are still excluded', isNotBoothList('Copy of SIR JUDGEMENT 27 MAY 2026.pdf'), true);
check('booth lists are not', isNotBoothList('S10_90_7_Govt School_03_08_2026_21_05_20.pdf'), false);
// Regression: booth names that happen to contain a guidance-document word must
// survive when they carry the canonical S10_<ac>_<part>_ prefix. These three
// real Gandhinagar (AC164) booths were being dropped statewide.
check('booth in a Public Instructions office is kept',
  isNotBoothList('S10_164_171_Deputy Director, Department of Public Instructions Office Room No. 1_03_08_2026_10_00_00.pdf'), false);
check('booth in an annexure building is kept',
  isNotBoothList('S10_164_214_Bangalore One annexure Building_03_08_2026_10_00_00.pdf'), false);
// A bare guidance document with no booth prefix is still excluded.
check('a loose annexure document is still excluded', isNotBoothList('Annexure-7 SIR format.pdf'), true);

// ------------------------------------------------------------------ verdict

if (failures.length) {
  log(`\nFAILED — ${failures.length} of ${passed + failures.length} checks:`);
  for (const f of failures) log(`  x ${f}`);
  process.exit(1);
}
log(`PASSED — ${passed} checks.`);
