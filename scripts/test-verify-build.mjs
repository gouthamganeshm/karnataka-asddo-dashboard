/* End-to-end regression test for stage 3 + verify-build, over a fixture.
 *
 * Why this exists, precisely: verify-build failed two correct statewide imports
 * in a row. Both times the build was right and the check was wrong, and both
 * times the mistake survived local testing because the local extract predated
 * the change being tested. A fixture removes that: the exact shape that broke
 * CI is written here, in six rows, and runs the real scripts.
 *
 * The shape that matters — one elector, one constituency, two documents:
 *
 *   part 12, booth list        Permanently Shifted
 *   part 12, consolidated list Already enrolled
 *
 * Same part number, different file. Stage 3 keeps one. The verifier must
 * recognise the other as a different document rather than a corrupted record.
 *
 *   node scripts/test-verify-build.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, log } from './lib/common.mjs';

const failures = [];
const check = (name, cond, detail = '') => {
  if (!cond) failures.push(`${name}${detail ? `\n      ${detail}` : ''}`);
};

const dir = mkdtempSync(join(tmpdir(), 'asddo-verify-'));
const cache = join(dir, 'cache');
const docs = join(dir, 'docs');
mkdirSync(join(cache, 'extracted'), { recursive: true });

const BOOTH = 'booth-file-id';
const CONSOLIDATED = 'consolidated-file-id';

const row = (epic, over) => JSON.stringify({
  serial: 1, epic, name: 'TEST ELECTOR', relative: 'TEST PARENT', relation: 'Father',
  age: 40, dob: '', reasonRaw: 'Permanently Shifted', category: 'shifted', dupEpic: '',
  district: 'TESTDIST', acNo: 999, acName: 'Testville',
  partNo: 12, partName: 'Test Booth', fileId: BOOTH, fileUrl: '', generatedOn: '01/08/2026',
  ...over
});

const rows = [
  // The conflict: same elector, same constituency, same part, two documents.
  row('AAA1111111'),
  row('AAA1111111', { reasonRaw: 'Already enrolled', category: 'duplicate', fileId: CONSOLIDATED }),
  // A plain duplicate that agrees — must not be reported as a conflict.
  row('BBB2222222'),
  row('BBB2222222', { fileId: CONSOLIDATED }),
  // Two ordinary records, so the fixture is not entirely duplicates.
  row('CCC3333333', { partNo: 7, reasonRaw: 'Death', category: 'death' }),
  row('DDD4444444', { partNo: 9, reasonRaw: 'Untraceable/Absent', category: 'absent' })
];

// The reason budget is a rate, so the fixture needs enough volume for a rate to
// mean anything. 2,000 uncontroversial rows put one conflict far under budget
// and wholesale corruption far over it — which is the distinction being tested.
const REASONS = [
  ['Permanently Shifted', 'shifted'], ['Death', 'death'],
  ['Untraceable/Absent', 'absent'], ['Already enrolled', 'duplicate']
];
for (let n = 0; n < 2000; n++) {
  const [reasonRaw, category] = REASONS[n % REASONS.length];
  const epic = `ZZ${String.fromCharCode(65 + (n % 26))}${String(1000000 + n).slice(-7)}`;
  rows.push(row(epic, { partNo: 20 + (n % 200), reasonRaw, category }));
}

writeFileSync(join(cache, 'extracted', 'testdist.ndjson'), rows.join('\n') + '\n');
writeFileSync(join(cache, 'manifest.json'), JSON.stringify({
  source: 'fixture', discoveredAt: new Date().toISOString(),
  districts: [{ name: 'TESTDIST', acs: [{ no: 999, name: 'Testville', files: [] }] }]
}));

const run = (script, extraEnv = {}) => execFileSync(
  process.execPath, [join(ROOT, 'scripts', script)],
  { env: { ...process.env, ASDDO_CACHE: cache, ASDDO_DOCS: docs, ...extraEnv }, encoding: 'utf8' }
);

try {
  run('3-build-site-data.mjs');

  // --sample-every 1 so every row is field-checked; the real run samples.
  let out = '';
  let exitCode = 0;
  try {
    out = execFileSync(
      process.execPath, [join(ROOT, 'scripts', 'verify-build.mjs'), '--sample-every', '1'],
      { env: { ...process.env, ASDDO_CACHE: cache, ASDDO_DOCS: docs }, encoding: 'utf8' }
    );
  } catch (err) {
    out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    exitCode = err.status ?? 1;
  }

  const num = (label) => {
    const m = new RegExp(`${label}\\s+([\\d,]+)`).exec(out);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };

  check('verify exits 0 on a build whose only disagreement is in the source',
    exitCode === 0, `exit ${exitCode}\n${out}`);
  check('reports PASSED', /PASSED/.test(out), out);
  check('no source rows missing', num('MISSING') === 0, `MISSING ${num('MISSING')}`);
  check('one record per EPIC per constituency', num('records in built data') === 2004,
    `built ${num('records in built data')}`);
  check('no EPIC twice in one constituency', num('same EPIC twice in one constituency') === 0);
  check('the contradictory row is recognised as a different document',
    num('superseded by another copy') >= 1, `superseded ${num('superseded by another copy')}`);
  check('the contradiction is reported against the other document',
    num('reason differs, other document') === 1,
    `other-document conflicts ${num('reason differs, other document')}`);
  check('nothing is charged against the same-document budget',
    num('reason differs, same document') === 0,
    `same-document mismatches ${num('reason differs, same document')}`);
  check('the conflict names the elector', /AAA1111111/.test(out), out.slice(-600));

  // The budget must still fail a build where reasons are corrupted in bulk:
  // rewrite every row's reason so the built data cannot agree with the source.
  const corrupted = rows.map((r) => {
    const o = JSON.parse(r);
    return JSON.stringify({ ...o, reasonRaw: 'Death', category: 'death' });
  });
  writeFileSync(join(cache, 'extracted', 'testdist.ndjson'), corrupted.join('\n') + '\n');

  let corruptExit = 0;
  let corruptOut = '';
  try {
    corruptOut = execFileSync(
      process.execPath, [join(ROOT, 'scripts', 'verify-build.mjs'), '--sample-every', '1'],
      { env: { ...process.env, ASDDO_CACHE: cache, ASDDO_DOCS: docs }, encoding: 'utf8' }
    );
  } catch (err) {
    corruptOut = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    corruptExit = err.status ?? 1;
  }
  check('mass reason corruption still fails the build',
    corruptExit !== 0 && /FAILED/.test(corruptOut), `exit ${corruptExit}\n${corruptOut.slice(-800)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  log(`\nFAILED — ${failures.length} check(s):`);
  for (const f of failures) log(`  x ${f}`);
  process.exit(1);
}
log('PASSED — verify-build tolerates a contradictory source and still catches corruption.');
