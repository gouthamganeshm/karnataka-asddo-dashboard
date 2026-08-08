/* Stage 5 (optional) — the electoral-roll existence index.
 *
 * This is what separates "your EPIC is not on the deletion list" from "we have
 * never heard of this EPIC". Without it a typo reads as an all-clear, which is
 * the one failure mode this whole tool exists to avoid, so the site degrades
 * honestly to two verdicts when this index is absent rather than guessing.
 *
 * Only existence is published, never identity: each EPIC becomes 4 bytes of
 * SHA-256, sorted, in a binary bucket the client binary-searches. There are no
 * names, no addresses and no reversible EPICs in the output.
 *
 *   node scripts/5-build-roll.mjs --input path/to/epics.txt
 *
 * `epics.txt` is any text file with one EPIC per line, or CSV/TSV with an EPIC
 * somewhere on each line. Assembling it is on you — see README "Electoral roll".
 */

import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { DOCS, fmtBytes, log, progress, readJson, sha256hex, writeJson } from './lib/common.mjs';

const OUT = resolve(DOCS, 'data', 'roll');
const TARGET_PER_SHARD = 2000; // ~8 KB per bucket after the 4-byte encoding

const args = process.argv.slice(2);
const input = argValue('--input');
function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}
if (!input) {
  log('Usage: node scripts/5-build-roll.mjs --input <file with one EPIC per line>');
  process.exit(1);
}

const EPIC_RE = /\b([A-Z]{3}[0-9]{7})\b/g;

// Pass 1: how many distinct EPICs, so the bucket depth can be chosen.
const seen = new Set();
let lines = 0;
await eachLine(input, (line) => {
  lines++;
  for (const m of line.toUpperCase().matchAll(EPIC_RE)) seen.add(m[1]);
  if (lines % 250000 === 0) progress(`  scanning ${lines} lines, ${seen.size} EPICs`);
});
progress('');

if (!seen.size) {
  log(`No EPIC-shaped values found in ${input}.`);
  process.exit(1);
}

const depth = Math.min(4, Math.max(1,
  Math.round(Math.log(seen.size / TARGET_PER_SHARD) / Math.log(16))
));
log(`${seen.size} distinct EPICs -> depth ${depth} (${16 ** depth} buckets)`);

const buckets = new Map();
let n = 0;
for (const epic of seen) {
  const hash = sha256hex(epic);
  const prefix = hash.slice(0, depth);
  // 32 bits after the prefix. Within a ~2000-entry bucket the odds of two
  // EPICs colliding are negligible, and a collision only ever produces a
  // false "this EPIC exists" — never a false deletion record.
  const suffix = parseInt(hash.slice(depth, depth + 8), 16);
  if (!buckets.has(prefix)) buckets.set(prefix, []);
  buckets.get(prefix).push(suffix >>> 0);
  if (++n % 200000 === 0) progress(`  hashing ${n}/${seen.size}`);
}
progress('');

await rm(OUT, { recursive: true, force: true });
let bytes = 0;
let done = 0;
for (const [prefix, list] of buckets) {
  list.sort((a, b) => a - b);
  const buf = Buffer.alloc(list.length * 4);
  for (let i = 0; i < list.length; i++) buf.writeUInt32BE(list[i], i * 4);
  const path = resolve(OUT, ...(prefix.length > 2 ? [prefix.slice(0, 2), prefix.slice(2) + '.bin'] : [prefix + '.bin']));
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, buf);
  bytes += buf.length;
  if (++done % 200 === 0) progress(`  writing ${done}/${buckets.size}`);
}
progress('');

const manifestPath = resolve(DOCS, 'data', 'manifest.json');
const manifest = await readJson(manifestPath);
if (!manifest) {
  log('docs/data/manifest.json missing. Run `npm run build` first.');
  process.exit(1);
}
await writeJson(manifestPath, {
  ...manifest,
  hasRoll: true,
  rollShardDepth: depth,
  rollCount: seen.size,
  rollImportedAt: new Date().toISOString()
}, true);

log(`\nWrote ${buckets.size} roll buckets (${fmtBytes(bytes)}) and flagged hasRoll in the manifest.`);

async function eachLine(path, fn) {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) fn(line);
}
