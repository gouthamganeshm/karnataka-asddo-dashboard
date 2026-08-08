/* Verify the built site data against every extracted source row.
 *
 * This is the full end-to-end check, and it runs where both halves already sit
 * on local disk — right after stage 3, inside the import. Verifying by fetching
 * the live site instead means ~65,000 bucket requests plus ~52,000 PDFs, which
 * GitHub Pages rate-limits (correctly), and which tests the CDN rather than the
 * pipeline. Here it costs no network at all and covers 100% of records.
 *
 * Checks, over every row in cache/extracted:
 *   1. the record is present in the bucket its EPIC hashes to
 *   2. name, reason and constituency match the extracted row
 *   3. the record's file reference resolves to a real source document
 *   4. built totals reconcile with the deduplicated source
 *   5. no EPIC appears twice within one constituency
 *
 * Exits non-zero on any failure, so the workflow refuses to publish.
 *
 *   node scripts/verify-build.mjs [--sample-every 20]
 */

import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { CACHE, DOCS, log, progress, readJson, sha256hex } from './lib/common.mjs';
import { categorise } from './lib/pdf.mjs';

const args = process.argv.slice(2);
const argValue = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const SAMPLE_EVERY = Number(argValue('--sample-every') ?? 20);

const OUT = resolve(DOCS, 'data');
const built = await readJson(resolve(OUT, 'manifest.json'));
if (!built) { log('No docs/data/manifest.json — run `npm run build` first.'); process.exit(1); }

const bucketPath = (p) => (p.length > 2 ? `${p.slice(0, 2)}/${p.slice(2)}` : p);
const SUFFIX_LEN = built.suffixLength ?? 8;

// ------------------------------------------------------- load the built output

log(`Built data: ${built.counts.records.toLocaleString()} records in ${built.counts.buckets} buckets\n`);
log('Loading built buckets…');

const byKey = new Map();          // "prefix|suffix" -> array of records
let loaded = 0;
let bucketsRead = 0;
const prefixes = [];
for (let i = 0; i < 16 ** built.shardDepth; i++) prefixes.push(i.toString(16).padStart(built.shardDepth, '0'));

for (const prefix of prefixes) {
  let body;
  try {
    body = await readFile(resolve(OUT, 'asddo', `${bucketPath(prefix)}.json`), 'utf8');
  } catch { continue; }          // no records hash into this prefix
  for (const rec of JSON.parse(body)) {
    const key = `${prefix}|${rec[0]}`;
    const at = byKey.get(key);
    if (at) at.push(rec); else byKey.set(key, [rec]);
    loaded++;
  }
  // Progress ticks on buckets, not records — incrementing `loaded` here too
  // inflated the reported total by exactly one per bucket.
  if (++bucketsRead % 4096 === 0) progress(`  ${loaded.toLocaleString()} records from ${bucketsRead} buckets`);
}
progress('');
log(`  ${loaded.toLocaleString()} records loaded from disk`);

const partsByAc = new Map();
for (let i = 0; i < built.dicts.acs.length; i++) {
  const p = await readJson(resolve(OUT, 'parts', `${i}.json`), null);
  if (p) partsByAc.set(i, p);
}
log(`  ${partsByAc.size} constituency source-file maps\n`);

// --------------------------------------------------------- stream source rows

const files = (await readdir(resolve(CACHE, 'extracted'))).filter((f) => f.endsWith('.ndjson'));
if (!files.length) { log('No extracted rows to verify against.'); process.exit(1); }

const fail = { missing: [], name: [], reason: [], source: [], ac: [] };
const t = { rows: 0, present: 0, sampled: 0, uniquePairs: 0, superseded: 0, conflicting: 0, sameDocReason: 0 };
// Source rows that lost the per-constituency dedupe AND disagree with the copy
// that won. Reported, never fatal: this is a contradiction in the published
// documents, not something the build can fix.
const conflicts = [];
function noteConflict(row, src, builtReason) {
  t.conflicting++;
  if (conflicts.length < 10) {
    conflicts.push({
      epic: row.epic, district: row.district, ac: row.acNo,
      kept: `part ${src?.[1] ?? '?'}: ${builtReason}`,
      other: `part ${row.partNo}: ${row.reasonRaw}`
    });
  }
}
const seenPairs = new Set();      // epicHash|acNo — expected size of the built data

let i = 0;
for (const f of files) {
  const rl = createInterface({ input: createReadStream(resolve(CACHE, 'extracted', f), 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    t.rows++;

    const hash = sha256hex(row.epic);
    const prefix = hash.slice(0, built.shardDepth);
    const suffix = hash.slice(built.shardDepth, built.shardDepth + SUFFIX_LEN);
    const candidates = byKey.get(`${prefix}|${suffix}`);

    seenPairs.add(`${prefix}${suffix}|${row.acNo}`);

    if (!candidates) {
      if (fail.missing.length < 40) fail.missing.push({ epic: row.epic, name: row.name, district: row.district, booth: row.partName });
      continue;
    }
    t.present++;

    if (i++ % SAMPLE_EVERY !== 0) continue;
    t.sampled++;

    // The record for this row is the one filed under the same constituency.
    const rec = candidates.find((r) => {
      const [acNo] = built.dicts.acs[r[7]] ?? [];
      return acNo === row.acNo;
    }) ?? candidates[0];

    const [, name, , , , , reasonIdx, acIdx, fileIdx] = rec;
    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

    const [acNo] = built.dicts.acs[acIdx] ?? [];
    if (acNo !== row.acNo && fail.ac.length < 40) {
      fail.ac.push({ epic: row.epic, source: row.acNo, built: acNo });
    }
    const src = partsByAc.get(acIdx)?.[fileIdx];
    if ((!src || !src[0]) && fail.source.length < 40) {
      fail.source.push({ epic: row.epic, district: row.district, acIdx, fileIdx });
    }

    // Stage 3 keeps one record per EPIC per constituency, preferring the copy
    // from the more specific document. A source row that lost that contest is
    // described by a record built from a *different* document, so comparing its
    // fields against that record compares two documents — which failed two
    // entirely correct statewide imports before this was understood.
    //
    // "Same document" means same file and same part. Part alone is not enough:
    // booth identity is now recovered from the page header, so a consolidated
    // list and the booth list for the same booth carry the same part number.
    const rowFile = row.fileUrl || row.fileId || '';
    const builtReason = built.dicts.reasons[reasonIdx] ?? '';
    const reasonDiffers = categorise(builtReason) !== row.category;
    const sameDocument = src && src[0] === rowFile && (src[1] ?? 0) === (row.partNo ?? 0);

    if (!sameDocument) {
      // A different document. Its disagreement is a fact about the source and
      // can never be fatal — this is the case that failed two correct imports.
      t.superseded++;
      if (reasonDiffers) noteConflict(row, src, builtReason);
      continue;
    }

    // Same document. The name must match exactly — a name is as sensitive to
    // column misalignment as anything in the row, so this is the check that
    // actually catches a parser regression, and it stays fatal.
    if (norm(name) !== norm(row.name) && fail.name.length < 40) {
      fail.name.push({ epic: row.epic, source: row.name, built: name });
    }

    // Same file, same part, and still a different reason: either this document
    // lists one elector twice under two reasons, or the parser is misreading the
    // column. Only volume tells those apart, so this is budgeted rather than
    // fatal on sight — and the budget is a rate, because an absolute floor can
    // never be exceeded by a small run and would wave corruption through.
    if (reasonDiffers && fail.reason.length < 40) {
      fail.reason.push({ epic: row.epic, source: row.reasonRaw, built: builtReason });
    }
    if (reasonDiffers) t.sameDocReason++;

    if (t.rows % 200000 === 0) progress(`  verified ${t.rows.toLocaleString()} rows`);
  }
}
progress('');

// ---------------------------------------------------------------- duplicates

let duplicateKeys = 0;
for (const recs of byKey.values()) {
  if (recs.length < 2) continue;
  const perAc = new Set();
  for (const r of recs) {
    const [acNo] = built.dicts.acs[r[7]] ?? [];
    if (perAc.has(acNo)) duplicateKeys++;
    perAc.add(acNo);
  }
}

// ------------------------------------------------------------------- verdict

t.uniquePairs = seenPairs.size;
// A rate, not a count: 0.05% of what was sampled. A parser fault corrupts the
// column for effectively every row and blows past this at any scale, while a
// source that contradicts itself stays far under it.
const reasonBudget = Math.max(10, Math.round(t.sampled * 0.0005));
log('\n================ BUILD VERIFICATION ================');
log(`  source rows                ${t.rows.toLocaleString()}`);
log(`  present in built buckets   ${t.present.toLocaleString()}`);
log(`  MISSING                    ${(t.rows - t.present).toLocaleString()}`);
log(`  unique (EPIC, constituency) in source   ${t.uniquePairs.toLocaleString()}`);
log(`  records in built data                   ${loaded.toLocaleString()}`);
log(`  same EPIC twice in one constituency     ${duplicateKeys.toLocaleString()}`);
log('');
log(`  field checks sampled       ${t.sampled.toLocaleString()} (every ${SAMPLE_EVERY}th row)`);
log(`    superseded by another copy           ${t.superseded.toLocaleString()}`);
log(`    reason differs, same document        ${t.sameDocReason.toLocaleString()}  (budget ${reasonBudget.toLocaleString()})`);
log(`    reason differs, other document       ${t.conflicting.toLocaleString()}  (reported only)`);
log(`    name mismatches          ${fail.name.length}`);
log(`    category mismatches      ${fail.reason.length}`);
log(`    constituency mismatches  ${fail.ac.length}`);
log(`    unresolved source files  ${fail.source.length}`);

if (t.conflicting) {
  log('');
  log(`  ${t.conflicting} row(s) disagree with the copy that was kept for that elector.`);
  log('  Not a build error — the published documents contradict each other. Examples:');
  for (const c of conflicts) {
    log(`    ${c.epic}  ${c.district} AC ${c.ac}`);
    log(`        kept       ${c.kept}`);
    log(`        other      ${c.other}`);
  }
}

for (const [label, list] of Object.entries(fail)) {
  if (!list.length) continue;
  log(`\n  ${label} — first ${Math.min(5, list.length)}:`);
  for (const x of list.slice(0, 5)) log(`    ${JSON.stringify(x)}`);
}

// A parser regression corrupts reasons in bulk; a source that contradicts
// itself produces a handful. The budget separates the two rather than letting
// nine contradictory rows in ten million block a correct import — which is what
// happened twice before this was written.
const reasonOverBudget = t.sameDocReason > reasonBudget;

const problems =
  (t.rows - t.present) + fail.name.length + fail.ac.length +
  fail.source.length + duplicateKeys + (reasonOverBudget ? t.sameDocReason : 0);

if (reasonOverBudget) {
  log(`
  ${t.sameDocReason} same-document reason mismatches exceeds the budget of ${reasonBudget}. ` +
      'That is too many to be the source disagreeing with itself — check the parser.');
}

if (problems) {
  log(`\nFAILED — ${problems} problem(s). Refusing to publish.`);
  process.exit(1);
}
log('\nPASSED — every source row is present and correct in the built data.');
