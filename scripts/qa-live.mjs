/* End-to-end QA against the published site.
 *
 * Takes one booth PDF per constituency straight from Drive, reads real EPICs out
 * of it, and asks the live site about each one — replicating exactly what the
 * browser does: hash the EPIC, derive the bucket path, fetch that one file.
 *
 * The point is that the two ends are independent. The PDF is the source of
 * truth; the site is the thing under test. A pass means the name, the reason and
 * the source link the site returns match the document the record came from.
 *
 * Also checks the negative paths: well-formed EPICs that should not exist, and
 * malformed input that should be refused before any lookup happens.
 *
 *   node scripts/qa-live.mjs [--limit 40] [--site <url>]
 *   node scripts/qa-live.mjs --every-booth --district BELLARY
 */

import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CACHE, ROOT, driveDownloadUrl, get, log, pool, progress, readJson, writeJson } from './lib/common.mjs';
import { parseBoothPdf } from './lib/pdf.mjs';
import { openArchiveBuffer } from './lib/archive.mjs';

// Two districts publish booths inside archives, so a booth is not always its own
// download. Without this, --every-booth reported 2,373 of 2,462 booths as
// "fetch failed" and passed on the 18 EPICs it could still reach — a sweep that
// looked green while silently skipping the two districts it was run for.
const archives = new Map();
function openArchiveOnce(file) {
  const id = file.zipId ?? file.zipUrl;
  if (!archives.has(id)) {
    archives.set(id, (async () =>
      new Map(openArchiveBuffer(await get(file.zipUrl ?? driveDownloadUrl(file.zipId),
        { tries: 3, timeoutMs: 180000 })).map((e) => [e.name, e])))());
  }
  return archives.get(id);
}

async function fetchBooth(file) {
  if (file.zipId || file.zipUrl) {
    const entry = (await openArchiveOnce(file)).get(file.entry);
    if (!entry) throw new Error(`no entry ${file.entry}`);
    return entry.read();
  }
  return get(file.url ?? driveDownloadUrl(file.id), { tries: 2, timeoutMs: 45000 });
}

const args = process.argv.slice(2);
const argValue = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };
const SITE = (argValue('--site') ?? 'https://gouthamganeshm.github.io/karnataka-asddo-dashboard').replace(/\/$/, '');
const LIMIT = Number(argValue('--limit') ?? 0);
const EPIC_RE = /^[A-Z]{3}[0-9]{7}$/;

const manifest = await readJson(resolve(CACHE, 'manifest.json'));
if (!manifest) { log('No cache/manifest.json — run `npm run discover` first.'); process.exit(1); }

log(`Site under test: ${SITE}`);
const live = await (await fetch(`${SITE}/data/manifest.json`)).json();
log(`Published data : ${live.counts.records.toLocaleString()} records, ` +
    `${live.counts.districts} districts, ${live.counts.constituencies} constituencies\n`);

// ---------------------------------------------------------------- site client

const bucketCache = new Map();
const partsCache = new Map();

async function getJson(path) {
  const r = await fetch(`${SITE}${path}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}

const bucketPath = (p) => (p.length > 2 ? `${p.slice(0, 2)}/${p.slice(2)}` : p);
const sourceUrl = (s) =>
  !s ? '' : /^https?:\/\//i.test(s) ? s : `https://drive.google.com/file/d/${s}/view`;

/** Exactly what docs/app.js does for one EPIC. */
async function lookup(epic) {
  if (!EPIC_RE.test(epic)) return { kind: 'invalid' };

  const hash = createHash('sha256').update(epic).digest('hex');
  const prefix = hash.slice(0, live.shardDepth);
  const suffix = hash.slice(live.shardDepth, live.shardDepth + (live.suffixLength ?? 8));

  if (!bucketCache.has(prefix)) {
    bucketCache.set(prefix, getJson(`/data/asddo/${bucketPath(prefix)}.json`).catch(() => null));
  }
  const bucket = (await bucketCache.get(prefix)) ?? [];
  const row = bucket.find((r) => r[0] === suffix);
  if (!row) return { kind: 'notListed' };

  const [, name, relative, relIdx, age, serial, reasonIdx, acIdx, fileIdx] = row;
  const [acNo, acName, districtIdx] = live.dicts.acs[acIdx];

  if (!partsCache.has(acIdx)) {
    partsCache.set(acIdx, getJson(`/data/parts/${acIdx}.json`).catch(() => null));
  }
  const sources = (await partsCache.get(acIdx)) ?? [];
  const src = Array.isArray(sources) ? sources[fileIdx] : null;

  return {
    kind: 'deleted',
    name, relative, age: age || null, serial,
    relation: relIdx >= 0 ? live.dicts.relations[relIdx] : '',
    reason: live.dicts.reasons[reasonIdx],
    district: live.dicts.districts[districtIdx],
    acNo, acName,
    partNo: src ? src[1] : null,
    partName: src ? src[2] : '',
    sourceUrl: src ? sourceUrl(src[0]) : ''
  };
}

// ------------------------------------------------------- sample one booth per AC

// --every-booth walks all 56,747 of them rather than one per constituency. That
// is the honest reading of "one voter from every booth", but it re-fetches every
// booth PDF from Drive — hours, not minutes — so it is opt-in. --district
// narrows it to somewhere worth that time, such as a district whose booth
// attribution has just changed.
const EVERY_BOOTH = args.includes('--every-booth');
const ONLY = argValue('--district')?.split(',').map((d) => d.trim().toUpperCase());

const perAc = new Map();
for (const district of manifest.districts) {
  if (ONLY && !ONLY.some((o) => district.name.includes(o))) continue;
  for (const ac of district.acs) {
    if (EVERY_BOOTH) {
      for (const file of ac.files) {
        perAc.set(`${district.name}/${ac.no ?? ac.name}/${file.partNo ?? file.name}`,
          { district: district.name, ac, file });
      }
      continue;
    }
    const key = `${district.name}/${ac.no ?? ac.name}`;
    if (perAc.has(key)) continue;
    // Middle of the list: less likely to be an odd first/last file.
    const file = ac.files[Math.floor(ac.files.length / 2)];
    if (file) perAc.set(key, { district: district.name, ac, file });
  }
}
let samples = [...perAc.values()];
if (LIMIT) samples = samples.slice(0, LIMIT);
log(`Sampling ${samples.length} booths (${EVERY_BOOTH ? 'every booth' : 'one per constituency'})…`);

const results = [];
let fetched = 0;

await pool(samples, 6, async (s) => {
  const rec = { district: s.district, acNo: s.ac.no, booth: s.file.name, checks: [] };
  let buf;
  try {
    buf = await fetchBooth(s.file);
  } catch (e) {
    rec.error = `fetch failed: ${e.message}`;
    results.push(rec);
    return;
  }
  if (buf.subarray(0, 4).toString('latin1') !== '%PDF') { rec.error = 'not a PDF'; results.push(rec); return; }

  const { rows } = parseBoothPdf(buf);
  if (!rows.length) { rec.note = 'no deletions in this booth'; results.push(rec); return; }

  // A consolidated list is one file covering hundreds of booths, so two records
  // per *file* leaves those booths untested — Bellary's 841 booths live in four
  // documents and got 8 EPICs between them. Sample one elector per booth the
  // document actually contains, which is what "every booth" has to mean for the
  // districts that publish this way. Ordinary booth files have a single part and
  // keep the first-and-middle pair.
  const byPart = new Map();
  for (const r of rows) {
    const key = r.pagePart?.no ?? '-';
    if (!byPart.has(key)) byPart.set(key, r);
  }
  const picks = byPart.size > 1
    ? [...byPart.values()]
    : [rows[0], rows[Math.floor(rows.length / 2)]].filter((r, i, a) => r && a.indexOf(r) === i);
  for (const row of picks) {
    const got = await lookup(row.epic);
    const nameOk = got.kind === 'deleted' &&
      got.name.replace(/\s+/g, ' ').trim().toUpperCase() === row.name.replace(/\s+/g, ' ').trim().toUpperCase();
    const reasonOk = got.kind === 'deleted' &&
      got.reason.toLowerCase().startsWith(row.reasonRaw.replace(/\s*\([A-Z]{3}\d{7}\)\s*/, '').trim().toLowerCase().slice(0, 8));
    const sourceOk = got.kind === 'deleted' && !!got.sourceUrl &&
      (!s.file.id || got.sourceUrl.includes(s.file.id));
    rec.checks.push({
      epic: row.epic,
      expectedName: row.name,
      found: got.kind === 'deleted',
      nameOk, reasonOk, sourceOk,
      liveName: got.name ?? '',
      liveReason: got.reason ?? '',
      liveAc: got.kind === 'deleted' ? `${got.acNo ?? '?'} ${got.acName ?? ''}`.trim() : '',
      liveSource: got.sourceUrl ?? ''
    });
  }
  results.push(rec);
  fetched++;
}, (n, t) => progress(`  ${n}/${t} booths checked`));

progress('');

// ------------------------------------------------------------- negative paths

log('\nChecking negative paths…');
const negatives = [];

// Well-formed but almost certainly nonexistent.
const fakes = ['ZZZ0000000', 'QQQ9999999', 'XYZ1111111', 'ZZQ4242424', 'JJJ7654321'];
// Plausible-looking: real prefixes, random digits.
for (const p of ['TXF', 'NMD', 'LXV', 'UTZ', 'JKX']) {
  fakes.push(p + String(Math.floor(1000000 + Math.random() * 8999999)));
}
for (const epic of fakes) {
  const got = await lookup(epic);
  negatives.push({ input: epic, kind: got.kind, pass: got.kind === 'notListed', type: 'well-formed, expected absent' });
}

// Malformed: must be refused before any lookup.
for (const bad of ['HELLO', 'ABC12345', 'ABC123456789', '1234567ABC', 'AB1234567', 'ABCD123456', '', 'ABC 1234567', 'abc1234567']) {
  const norm = bad.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const got = await lookup(norm);
  const pass = norm === '' ? true : got.kind === 'invalid' || (EPIC_RE.test(norm) && got.kind === 'notListed');
  negatives.push({ input: JSON.stringify(bad), kind: norm === '' ? 'empty' : got.kind, pass, type: 'malformed, expected refusal' });
}

// ------------------------------------------------------------------- report

const flat = results.flatMap((r) => r.checks.map((c) => ({ ...c, district: r.district, acNo: r.acNo, booth: r.booth })));
const totals = {
  boothsSampled: results.length,
  boothsFetchFailed: results.filter((r) => r.error).length,
  boothsNoDeletions: results.filter((r) => r.note).length,
  epicsChecked: flat.length,
  found: flat.filter((c) => c.found).length,
  nameMatch: flat.filter((c) => c.nameOk).length,
  reasonMatch: flat.filter((c) => c.reasonOk).length,
  sourceLinkOk: flat.filter((c) => c.sourceOk).length,
  negativesChecked: negatives.length,
  negativesPassed: negatives.filter((n) => n.pass).length
};

log('\n================ RESULTS ================');
for (const [k, v] of Object.entries(totals)) log(`  ${k.padEnd(20)} ${v}`);

const failures = flat.filter((c) => !c.found || !c.nameOk || !c.sourceOk);
if (failures.length) {
  log(`\n  ${failures.length} EPIC check(s) with a problem:`);
  for (const f of failures.slice(0, 25)) {
    log(`    ${f.epic}  ${f.district}/${f.acNo}  found=${f.found} name=${f.nameOk} source=${f.sourceOk}`);
    if (f.found && !f.nameOk) log(`        pdf="${f.expectedName}"  live="${f.liveName}"`);
  }
}
const negFails = negatives.filter((n) => !n.pass);
if (negFails.length) {
  log(`\n  ${negFails.length} negative check(s) failed:`);
  for (const n of negFails) log(`    ${n.input} -> ${n.kind}  (${n.type})`);
}

await writeJson(resolve(ROOT, 'qa-results.json'), { site: SITE, ranAt: new Date().toISOString(), publishedCounts: live.counts, totals, records: flat, negatives, boothIssues: results.filter((r) => r.error || r.note) }, true);
log(`\nFull detail: qa-results.json`);
