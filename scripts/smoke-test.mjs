/* Smoke test — reimplements the client's lookup against the built files in
   docs/data and asserts the four verdicts.
 *
 * The point is the verdict logic, not the UI: "not on the deletion list" and
 * "we have never heard of this number" must never collapse into each other,
 * because that collapse is what turns a typo into a false all-clear.
 *
 *   node scripts/smoke-test.mjs <EPIC-expected-to-be-deleted>
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOCS, log, sha256hex } from './lib/common.mjs';

const DATA = resolve(DOCS, 'data');
const manifest = JSON.parse(await readFile(resolve(DATA, 'manifest.json'), 'utf8'));

const bucketPath = (prefix, ext) =>
  prefix.length > 2 ? [prefix.slice(0, 2), `${prefix.slice(2)}.${ext}`] : [`${prefix}.${ext}`];

async function lookup(epic) {
  if (!/^[A-Z]{3}[0-9]{7}$/.test(epic)) return { kind: 'invalid' };

  const hash = await sha256hex(epic);
  const prefix = hash.slice(0, manifest.shardDepth);
  const suffix = hash.slice(manifest.shardDepth, manifest.shardDepth + manifest.suffixLength);

  let bucket = [];
  try {
    bucket = JSON.parse(await readFile(resolve(DATA, 'asddo', ...bucketPath(prefix, 'json')), 'utf8'));
  } catch { /* no bucket means no deletion hashes into this prefix */ }

  const matches = bucket.filter((r) => r[0] === suffix);
  if (matches.length) {
    return {
      kind: 'deleted',
      records: matches.map((r) => ({
        name: r[1],
        reason: manifest.dicts.reasons[r[6]],
        ac: manifest.dicts.acs[r[7]][1],
        part: r[8]
      }))
    };
  }

  if (!manifest.hasRoll) return { kind: 'notListed' };
  if (await inRoll(hash)) return { kind: 'clear' };
  // Must mirror docs/app.js: a partial roll index never produces the alarming
  // "not found anywhere" verdict.
  return (manifest.rollCoverage ?? 100) < 95
    ? { kind: 'notListed', partialRoll: true }
    : { kind: 'unknown' };
}

async function inRoll(hash) {
  const depth = manifest.rollShardDepth;
  const prefix = hash.slice(0, depth);

  // Details mode stores JSON records; --existence-only stores sorted uint32s.
  if (manifest.rollHasDetails) {
    const suffix = hash.slice(depth, depth + (manifest.rollSuffixLength ?? 8));
    try {
      const bucket = JSON.parse(
        await readFile(resolve(DATA, 'roll', ...bucketPath(prefix, 'json')), 'utf8')
      );
      return bucket.some((r) => r[0] === suffix);
    } catch {
      return false;
    }
  }

  const needle = parseInt(hash.slice(depth, depth + 8), 16) >>> 0;
  let buf;
  try {
    buf = await readFile(resolve(DATA, 'roll', ...bucketPath(prefix, 'bin')));
  } catch {
    return false;
  }
  let lo = 0;
  let hi = buf.length / 4 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = buf.readUInt32BE(mid * 4);
    if (value === needle) return true;
    if (value < needle) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

const deletedEpic = process.argv[2];
const cases = [
  ['HELLO', 'invalid'],
  ['ZZZ0000000', manifest.hasRoll && (manifest.rollCoverage ?? 100) >= 95 ? 'unknown' : 'notListed'],
  ...(deletedEpic ? [[deletedEpic, 'deleted']] : [])
];

let failed = 0;
for (const [epic, expected] of cases) {
  const result = await lookup(epic);
  const ok = result.kind === expected;
  if (!ok) failed++;
  const detail = result.kind === 'deleted'
    ? ` (${result.records.length} record(s), reason "${result.records[0].reason}")`
    : '';
  log(`${ok ? 'PASS' : 'FAIL'}  ${epic.padEnd(12)} -> ${result.kind}${detail}${ok ? '' : `  expected ${expected}`}`);
}

log(`\nhasRoll: ${manifest.hasRoll}   buckets: ${manifest.counts.buckets}   records: ${manifest.counts.records}`);
if (!manifest.hasRoll) {
  log('No roll index: the site shows two verdicts and says so. See README "Electoral roll".');
}
process.exit(failed ? 1 : 0);
