/* Full end-to-end verification: every booth, every constituency.
 *
 * Two independent halves, compared against each other:
 *
 *   PUBLISHED  every bucket on the live site, loaded into one sorted
 *              BigUint64Array of (prefix<<32 | suffix). 10.4M records fit in
 *              ~83 MB that way; a Map of records would need 2 GB+.
 *   SOURCE     every booth PDF, streamed from Drive and parsed in memory.
 *
 * Then: is every record in the source present on the site, and does the site
 * hold anything the source does not? Field-level accuracy (name, reason, source
 * link) is checked on a sample per booth, because that needs the bucket body
 * rather than just the key.
 *
 *   node --max-old-space-size=4096 scripts/qa-full.mjs
 *   node --max-old-space-size=4096 scripts/qa-full.mjs --districts KODAGU,HASSAN
 *   node scripts/qa-full.mjs --sample-every 50     # field checks per booth
 *
 * Expect roughly three hours for the whole state: ~65k bucket fetches plus
 * ~52k PDF fetches. Nothing is written to disk except the report.
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CACHE, ROOT, driveDownloadUrl, fmtBytes, get, log, pool, progress, readJson, writeJson } from './lib/common.mjs';
import { parseBoothPdf } from './lib/pdf.mjs';

const args = process.argv.slice(2);
const argValue = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const SITE = (argValue('--site') ?? 'https://gouthamganeshm.github.io/karnataka-asddo-dashboard').replace(/\/$/, '');
const only = argValue('--districts')?.split(',').map((s) => s.trim().toUpperCase());
const SAMPLE_EVERY = Number(argValue('--sample-every') ?? 25);
const BUCKET_CONCURRENCY = Number(argValue('--bucket-concurrency') ?? 24);
const PDF_CONCURRENCY = Number(argValue('--pdf-concurrency') ?? 8);

const manifest = await readJson(resolve(CACHE, 'manifest.json'));
if (!manifest) { log('No cache/manifest.json — run `npm run discover` first.'); process.exit(1); }

const live = await (await fetch(`${SITE}/data/manifest.json`)).json();
log(`Site      : ${SITE}`);
log(`Published : ${live.counts.records.toLocaleString()} records, ${live.counts.constituencies} constituencies, ` +
    `${live.counts.buckets} buckets (depth ${live.shardDepth})\n`);

const SUFFIX_LEN = live.suffixLength ?? 8;
const bucketPath = (p) => (p.length > 2 ? `${p.slice(0, 2)}/${p.slice(2)}` : p);
const keyOf = (prefix, suffix) => (BigInt(parseInt(prefix, 16)) << 32n) | BigInt(parseInt(suffix, 16));

// ------------------------------------------------- phase 1: load the site index

const prefixes = [];
const width = live.shardDepth;
for (let i = 0; i < 16 ** width; i++) prefixes.push(i.toString(16).padStart(width, '0'));

log(`Phase 1 — loading ${prefixes.length} buckets from the site…`);
let keys = new BigUint64Array(Math.max(live.counts.records + 1000, 1024));
let n = 0;
let bucketsMissing = 0;
let bytesIn = 0;
const acIdxByKey = new Map();   // only for buckets we sample, filled in phase 2

let bucketsErrored = 0;

/**
 * A throttled response is not an absent bucket, and conflating the two is how a
 * verification tool invents a headline. At high concurrency GitHub Pages sheds
 * load, and counting those as "missing" produced a false 12,000-bucket gap on an
 * earlier run — which would then have reported real records as missing from the
 * site. 404 means absent; anything else is retried, and a bucket that still
 * fails is counted separately and fails the run rather than silently shrinking
 * the index.
 */
async function loadBucket(prefix, tries = 5) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const r = await fetch(`${SITE}/data/asddo/${bucketPath(prefix)}.json`);
      if (r.status === 404) return null;              // genuinely absent
      if (r.ok) return await r.text();
      if (attempt === tries) return undefined;        // gave up
    } catch {
      if (attempt === tries) return undefined;
    }
    await new Promise((r) => setTimeout(r, 250 * attempt * attempt));
  }
  return undefined;
}

await pool(prefixes, BUCKET_CONCURRENCY, async (prefix) => {
  const body = await loadBucket(prefix);
  if (body === null) { bucketsMissing++; return; }
  if (body === undefined) { bucketsErrored++; return; }
  bytesIn += body.length;
  let records;
  try { records = JSON.parse(body); } catch { bucketsErrored++; return; }
  for (const rec of records) {
    if (n >= keys.length) { // grow defensively; published count should bound this
      const bigger = new BigUint64Array(keys.length * 2);
      bigger.set(keys);
      keys = bigger;
    }
    keys[n++] = keyOf(prefix, rec[0]);
  }
}, (done, total) => progress(`  buckets ${done}/${total}  records ${n}  ${fmtBytes(bytesIn)}  absent ${bucketsMissing}  errored ${bucketsErrored}`));

progress('');
const index = keys.subarray(0, n);
index.sort();
log(`  loaded ${n.toLocaleString()} published records (${fmtBytes(bytesIn)}), ${bucketsMissing} buckets absent, ${bucketsErrored} errored`);
if (bucketsErrored) {
  log(`
  ABORTING: ${bucketsErrored} bucket(s) could not be read after retries.`);
  log('  The index would be incomplete, and every record in those buckets would be');
  log('  falsely reported as missing from the site. Lower --bucket-concurrency and re-run.');
  process.exit(1);
}
if (n !== live.counts.records) {
  log(`  note: loaded ${n} records but the manifest claims ${live.counts.records} (difference ${n - live.counts.records})`);
}

// Adjacent equal keys are the same EPIC stored twice.
let publishedDuplicates = 0;
for (let i = 1; i < index.length; i++) if (index[i] === index[i - 1]) publishedDuplicates++;
log(`  duplicate keys in published data: ${publishedDuplicates.toLocaleString()}`);

function isPublished(prefix, suffix) {
  const target = keyOf(prefix, suffix);
  let lo = 0, hi = index.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index[mid] === target) return true;
    if (index[mid] < target) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// ------------------------------------------------- phase 2: stream every booth

const jobs = [];
for (const district of manifest.districts) {
  if (only && !only.some((o) => district.name.includes(o))) continue;
  for (const ac of district.acs) {
    for (const file of ac.files) jobs.push({ district: district.name, ac, file });
  }
}
log(`\nPhase 2 — streaming ${jobs.length.toLocaleString()} booth PDFs…`);

const bucketBodyCache = new Map();
async function bucketRecords(prefix) {
  if (!bucketBodyCache.has(prefix)) {
    if (bucketBodyCache.size > 400) bucketBodyCache.clear(); // keep memory bounded
    bucketBodyCache.set(prefix, fetch(`${SITE}/data/asddo/${bucketPath(prefix)}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []));
  }
  return bucketBodyCache.get(prefix);
}
const partsCache = new Map();
async function acSources(acIdx) {
  if (!partsCache.has(acIdx)) {
    partsCache.set(acIdx, fetch(`${SITE}/data/parts/${acIdx}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []));
  }
  return partsCache.get(acIdx);
}

const t = {
  booths: 0, boothsFailed: 0, boothsScanned: 0, boothsNoRows: 0,
  sourceRecords: 0, present: 0, missing: 0,
  fieldsChecked: 0, nameOk: 0, reasonOk: 0, sourceLinkOk: 0,
  bytes: 0
};
const missingSamples = [];
const fieldFailures = [];
const perDistrict = new Map();

await pool(jobs, PDF_CONCURRENCY, async (job) => {
  let buf;
  try {
    buf = await get(job.file.url ?? driveDownloadUrl(job.file.id), { tries: 2, timeoutMs: 60000 });
  } catch {
    t.boothsFailed++;
    return;
  }
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') { t.boothsFailed++; return; }
  t.bytes += buf.length;
  t.booths++;

  const { rows } = parseBoothPdf(buf);
  if (!rows.length) { t.boothsNoRows++; return; }

  if (!perDistrict.has(job.district)) perDistrict.set(job.district, { source: 0, present: 0, missing: 0 });
  const d = perDistrict.get(job.district);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const hash = createHash('sha256').update(row.epic).digest('hex');
    const prefix = hash.slice(0, live.shardDepth);
    const suffix = hash.slice(live.shardDepth, live.shardDepth + SUFFIX_LEN);

    t.sourceRecords++;
    d.source++;
    if (isPublished(prefix, suffix)) { t.present++; d.present++; }
    else {
      t.missing++;
      d.missing++;
      if (missingSamples.length < 60) {
        missingSamples.push({ epic: row.epic, name: row.name, district: job.district, booth: job.file.name });
      }
      continue;
    }

    // Field-level check on a sample: needs the bucket body, not just the key.
    if (i % SAMPLE_EVERY !== 0) continue;
    const bucket = await bucketRecords(prefix);
    const rec = bucket.find((r) => r[0] === suffix);
    if (!rec) continue;
    const [, name, , , , , reasonIdx, acIdx, fileIdx] = rec;
    const liveReason = live.dicts.reasons[reasonIdx] ?? '';
    const srcs = await acSources(acIdx);
    const src = Array.isArray(srcs) ? srcs[fileIdx] : null;

    const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
    const expectedReason = row.reasonRaw.replace(/\s*\([A-Z]{3}\d{7}\)\s*/, '').trim();
    t.fieldsChecked++;
    const nOk = norm(name) === norm(row.name);
    const rOk = norm(liveReason).startsWith(norm(expectedReason).slice(0, 8));
    const sOk = !!src && !!src[0];
    if (nOk) t.nameOk++;
    if (rOk) t.reasonOk++;
    if (sOk) t.sourceLinkOk++;
    if ((!nOk || !rOk || !sOk) && fieldFailures.length < 60) {
      fieldFailures.push({
        epic: row.epic, district: job.district, booth: job.file.name,
        pdfName: row.name, liveName: name,
        pdfReason: expectedReason, liveReason,
        hasSource: sOk, nameOk: nOk, reasonOk: rOk
      });
    }
  }
}, (done, total) =>
  progress(`  booths ${done}/${total}  records ${t.sourceRecords.toLocaleString()}  ` +
           `present ${t.present.toLocaleString()}  missing ${t.missing}  ` +
           `failed ${t.boothsFailed}  ${fmtBytes(t.bytes)}`)
);

progress('');

// ------------------------------------------------------------------- report

const districts = [...perDistrict.entries()]
  .map(([name, v]) => ({ name, ...v, missingPct: v.source ? +(100 * v.missing / v.source).toFixed(3) : 0 }))
  .sort((a, b) => b.missing - a.missing);

log('\n================ FULL VERIFICATION ================');
log(`  booths fetched          ${t.booths.toLocaleString()} / ${jobs.length.toLocaleString()}   (failed ${t.boothsFailed}, no rows ${t.boothsNoRows})`);
log(`  streamed                ${fmtBytes(t.bytes)}`);
log(`  source records parsed   ${t.sourceRecords.toLocaleString()}`);
log(`  present on the site     ${t.present.toLocaleString()}`);
log(`  MISSING from the site   ${t.missing.toLocaleString()}`);
log(`  published records       ${n.toLocaleString()}  (duplicates: ${publishedDuplicates.toLocaleString()})`);
log(`  published minus source  ${(n - t.sourceRecords).toLocaleString()}`);
log('');
log(`  field checks            ${t.fieldsChecked.toLocaleString()} sampled (every ${SAMPLE_EVERY}th record)`);
log(`    name matches          ${t.nameOk.toLocaleString()}`);
log(`    reason matches        ${t.reasonOk.toLocaleString()}`);
log(`    source link present   ${t.sourceLinkOk.toLocaleString()}`);

if (districts.some((d) => d.missing)) {
  log('\n  districts with missing records:');
  for (const d of districts.filter((x) => x.missing).slice(0, 20)) {
    log(`    ${d.name.padEnd(20)} ${d.missing.toLocaleString().padStart(9)} of ${d.source.toLocaleString().padStart(9)}  (${d.missingPct}%)`);
  }
}
if (fieldFailures.length) log(`\n  ${fieldFailures.length} field mismatch sample(s) recorded in the report`);

await writeJson(resolve(ROOT, 'qa-full-results.json'), {
  site: SITE, ranAt: new Date().toISOString(),
  publishedCounts: live.counts, totals: t,
  publishedRecordsLoaded: n, publishedDuplicates, bucketsMissing, bucketsErrored,
  districts, missingSamples, fieldFailures
}, true);
log('\nFull detail: qa-full-results.json');
