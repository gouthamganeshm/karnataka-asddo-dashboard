/* Stage 3b — MERGE build.
 *
 * Publish fresh data for the districts we could crawl COMPLETELY this run, while
 * preserving every other district's records byte-for-byte from the existing
 * (live) build. Used when part of the source is temporarily unavailable — the
 * CEO links a district's Drive folders before sharing them, so they 401/404 and
 * a full rebuild would drop those districts. Refresh only what is complete; keep
 * the rest exactly as it was.
 *
 * Safe by construction: a district is refreshed ONLY if it appears in the fresh
 * extracted rows (it was crawled + extracted this run). Every other district is
 * copied through untouched, so no district is ever dropped — worst case it stays
 * on the data it already had. A verification pass at the end asserts that every
 * NON-refreshed district's record count is unchanged from the live build.
 *
 * The LIVE manifest's dictionaries are reused append-only: preserved records keep
 * their existing indices (so they still decode), and fresh records share the same
 * dictionaries with any new values appended.
 *
 *   LIVE_DATA=docs/data SITE_DATA_OUT=/tmp/out node --max-old-space-size=6144 \
 *     scripts/3b-merge-build.mjs
 */
import { createReadStream } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { CACHE, ROOT, fmtBytes, log, progress, readJson, sha256hex, writeJson } from './lib/common.mjs';
import { CATEGORIES, categorise } from './lib/pdf.mjs';

const IN_DIR = resolve(CACHE, 'extracted');
const LIVE = resolve(process.env.LIVE_DATA || resolve(ROOT, 'docs', 'data'));
const OUT = resolve(process.env.SITE_DATA_OUT || resolve(ROOT, 'docs', 'data'));
const cleanBoothName = (name) => (/^\d{6,}$/.test(String(name ?? '').trim()) ? '' : (name ?? ''));

const live = await readJson(resolve(LIVE, 'manifest.json'));
if (!live?.dicts) { log('::error::MERGE needs an existing build at LIVE_DATA/manifest.json'); process.exit(1); }
const { shardDepth, suffixLength } = live;
const acNames = (await readJson(resolve(ROOT, 'seed', 'ac-names.json'), {})) ?? {};

// ---- dictionaries: seed from the live build, extend append-only --------------
const dicts = {
  districts: [...live.dicts.districts],
  acs: live.dicts.acs.map((a) => [...a]),
  reasons: [...live.dicts.reasons],
  relations: [...live.dicts.relations]
};
const index = new Map();
dicts.districts.forEach((v, i) => index.set('districts ' + v, i));
dicts.reasons.forEach((v, i) => index.set('reasons ' + v, i));
dicts.relations.forEach((v, i) => index.set('relations ' + v, i));
// AC key mirrors 3-build: dedupe a constituency by ECI number (fallback name),
// scoped to its district index, so folder "AC 174" and header "Mahadevapura" fold together.
dicts.acs.forEach((a, i) => {
  const [acNo, , districtIdx] = a;
  const key = acNo != null ? `#${acNo}${districtIdx}` : `name:${a[1]}${districtIdx}`;
  index.set('acs ' + key, i);
});
function intern(dict, value) {
  const key = dict + ' ' + value;
  if (index.has(key)) return index.get(key);
  const i = dicts[dict].push(value) - 1;
  index.set(key, i);
  return i;
}
const districtOfAcIdx = (acIdx) => dicts.districts[dicts.acs[acIdx][2]];

// ---- which districts are being refreshed this run ----------------------------
let files;
try { files = (await readdir(IN_DIR)).filter((f) => f.endsWith('.ndjson')); } catch { files = []; }
if (!files.length) { log('::error::No extracted rows to merge. Run extract first.'); process.exit(1); }

// ---- build fresh records from the extracted rows (reusing live dicts) ---------
const freshShards = new Map();      // prefix -> record[]
const sourceFiles = new Map();      // acIdx -> { index:Map, list:[] }  (fresh acIdx only)
const refreshedAcIdx = new Set();
const refreshedDistricts = new Set();
const freshDistrictTotals = new Map();   // district -> fresh row count (for the collapse check)
let freshRows = 0;

async function eachRow(path, fn) {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) fn(JSON.parse(line));
}

for (const f of files) {
  await eachRow(resolve(IN_DIR, f), (row) => {
    const hash = sha256hex(row.epic);
    const prefix = hash.slice(0, shardDepth);
    const suffix = hash.slice(shardDepth, shardDepth + suffixLength);

    const districtIdx = intern('districts', row.district);
    refreshedDistricts.add(row.district);
    freshDistrictTotals.set(row.district, (freshDistrictTotals.get(row.district) ?? 0) + 1);
    const acKey = row.acNo != null ? `#${row.acNo}${districtIdx}` : `name:${row.acName}${districtIdx}`;
    let acIdx = index.get('acs ' + acKey);
    if (acIdx === undefined) {
      acIdx = dicts.acs.push([row.acNo, acNames[row.acNo] || row.acName, districtIdx]) - 1;
      index.set('acs ' + acKey, acIdx);
    }
    refreshedAcIdx.add(acIdx);

    const reasonLabel = (row.reasonRaw || 'Not stated').replace(/\s*\(.*$/s, '').trim() || 'Not stated';
    const reasonIdx = intern('reasons', reasonLabel);
    const relIdx = row.relation ? intern('relations', row.relation) : -1;

    if (!sourceFiles.has(acIdx)) sourceFiles.set(acIdx, { index: new Map(), list: [] });
    const acFiles = sourceFiles.get(acIdx);
    const fileKey = `${row.fileUrl || row.fileId || 'part'}|${row.partNo ?? ''}`;
    let fileIdx = acFiles.index.get(fileKey);
    if (fileIdx === undefined) {
      fileIdx = acFiles.list.length;
      acFiles.index.set(fileKey, fileIdx);
      acFiles.list.push([row.fileUrl || row.fileId || '', row.partNo ?? 0, cleanBoothName(row.partName), row.generatedOn ?? '']);
    }

    if (!freshShards.has(prefix)) freshShards.set(prefix, []);
    freshShards.get(prefix).push([
      suffix, row.name, row.relative, relIdx, row.age ?? 0, row.serial ?? 0, reasonIdx, acIdx, fileIdx,
      row.dupEpic ? row.dupEpic.slice(0, 3) + '****' + row.dupEpic.slice(-3) : ''
    ]);
    if (++freshRows % 20000 === 0) progress(`  bucketing fresh ${freshRows}`);
  });
}
progress('');

// ---- collapse guard: preserve a whole district whose fresh rows fell far below
// the live build (a district-wide download shortfall or a source reduction). This
// keeps one collapsed district from blocking the entire publish — the other,
// healthy districts still go live, and the collapsed one stays on its live data
// and is flagged for review. (Booth-level shortfalls don't reach here: those
// booths are preserved individually, so the district total stays near live.)
const COLLAPSE_FLOOR = Number(process.env.MERGE_COLLAPSE_FLOOR ?? 0.7);
const liveStats0 = await readJson(resolve(LIVE, 'stats.json'), { districts: [] });
const liveTotalByDistrict = new Map((liveStats0.districts ?? []).map((d) => [d.name, d.total]));
const demotedSet = new Set();
for (const name of [...refreshedDistricts]) {
  const live = liveTotalByDistrict.get(name) ?? 0;
  const fresh = freshDistrictTotals.get(name) ?? 0;
  if (live > 1000 && fresh < live * COLLAPSE_FLOOR) {
    demotedSet.add(name);
    refreshedDistricts.delete(name);
  }
}
if (demotedSet.size) {
  for (const acIdx of [...refreshedAcIdx]) {
    if (demotedSet.has(dicts.districts[dicts.acs[acIdx][2]])) { refreshedAcIdx.delete(acIdx); sourceFiles.delete(acIdx); }
  }
  // A demoted district is preserved from live, so its freshly-extracted rows are
  // deliberately NOT published. Remove them from cache/extracted so verify-build
  // (which checks every extracted row is in the built data) does not flag them as
  // missing and fail the run.
  const dslug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const name of demotedSet) {
    await rm(resolve(IN_DIR, `${dslug(name)}.ndjson`), { force: true });
    await rm(resolve(IN_DIR, `${dslug(name)}.done`), { force: true });
  }
  const detail = [...demotedSet].map((n) => `${n} (fresh ${freshDistrictTotals.get(n)} vs live ${liveTotalByDistrict.get(n)} = ${((freshDistrictTotals.get(n) / liveTotalByDistrict.get(n)) * 100).toFixed(0)}%)`);
  log(`::warning::${demotedSet.size} district(s) collapsed on fetch — PRESERVED from live (kept on old data, flagged for review) so the healthy districts still publish: ${detail.join(', ')}`);
}
log(`Refreshing ${refreshedDistricts.size} district(s): ${[...refreshedDistricts].sort().join(', ')}`);
log(`Preserving ${dicts.districts.length - refreshedDistricts.size} district(s) from the live build.`);

// ---- BOOTH-LEVEL preserve: for each refreshed AC, keep the live records of any
// booth that was NOT re-fetched this run (a failed download), and append those
// failed booths' source-file entries onto the fresh parts list, remapping their
// fileIdx. So every booth that downloaded is refreshed and only the failed booths
// stay on their previous data — a few failed booths never discard a whole
// district (the BAGALKOT-lost-to-one-booth case).
const acMerge = new Map(); // acIdx -> { freshPartNos:Set, mergedList, remap:Map(oldFileIdx->newFileIdx), livePartNo:[partNo by live fileIdx] }
for (const acIdx of refreshedAcIdx) {
  const freshList = sourceFiles.get(acIdx)?.list ?? [];
  const freshPartNos = new Set(freshList.map((e) => e[1]));
  const liveList = (await readJson(resolve(LIVE, 'parts', `${acIdx}.json`), [])) ?? [];
  const mergedList = [...freshList];
  const remap = new Map();
  liveList.forEach((entry, oldIdx) => {
    if (!freshPartNos.has(entry[1])) { remap.set(oldIdx, mergedList.length); mergedList.push(entry); }
  });
  acMerge.set(acIdx, { freshPartNos, mergedList, remap, livePartNo: liveList.map((e) => e[1]) });
}

// Source-file list for stats/search: the merged list for a refreshed AC, the
// fresh list for a brand-new AC, else the live list for a preserved AC.
const livePartsCache = new Map();
async function partsFor(acIdx) {
  if (acMerge.has(acIdx)) return acMerge.get(acIdx).mergedList;
  if (sourceFiles.has(acIdx)) return sourceFiles.get(acIdx).list;
  if (!livePartsCache.has(acIdx)) livePartsCache.set(acIdx, (await readJson(resolve(LIVE, 'parts', `${acIdx}.json`), [])) ?? []);
  return livePartsCache.get(acIdx);
}

// ---- write merged buckets ----------------------------------------------------
await rm(resolve(OUT, 'asddo'), { recursive: true, force: true });
await rm(resolve(OUT, 'search'), { recursive: true, force: true });
const shardPath = (p) => (p.length > 2 ? `${p.slice(0, 2)}/${p.slice(2)}.json` : `${p}.json`);

const stats = {
  total: 0, byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, 0])),
  districts: new Map(), acTotals: new Map(), acDetail: new Map(),
  ageBands: { '18-29': 0, '30-44': 0, '45-59': 0, '60-79': 0, '80+': 0, unknown: 0 },
  booths: new Set(), generatedOn: new Set()
};
const searchRows = new Map();
const livePreserved = new Map();     // district -> count preserved (untouched districts, for verification)
let dropped = 0, bytes = 0, written = 0, bucketCount = 0, preservedBooths = 0;

async function tally(rec) {
  const [, , , , age, , reasonIdx, acIdx, fileIdx] = rec;
  const [acNo, , districtIdx] = dicts.acs[acIdx];
  const district = dicts.districts[districtIdx];
  const category = categorise(dicts.reasons[reasonIdx]);
  const src = (await partsFor(acIdx))[fileIdx];
  const partNo = src ? src[1] : 0;
  const generatedOn = src ? src[3] : '';
  stats.total++; stats.byCategory[category]++;
  if (!stats.districts.has(district)) stats.districts.set(district, { total: 0, ...Object.fromEntries(CATEGORIES.map((c) => [c, 0])), acs: new Set(), booths: new Set() });
  const d = stats.districts.get(district);
  d.total++; d[category]++; d.acs.add(acNo); d.booths.add(`${acNo}/${partNo}`);
  stats.acTotals.set(acIdx, (stats.acTotals.get(acIdx) ?? 0) + 1);
  if (!stats.acDetail.has(acIdx)) stats.acDetail.set(acIdx, { ...Object.fromEntries(CATEGORIES.map((c) => [c, 0])), total: 0, booths: new Set() });
  const ad = stats.acDetail.get(acIdx); ad.total++; ad[category]++; ad.booths.add(partNo);
  stats.booths.add(`${acNo}/${partNo}`);
  if (generatedOn) stats.generatedOn.add(generatedOn);
  if (!age) stats.ageBands.unknown++;
  else if (age < 30) stats.ageBands['18-29']++; else if (age < 45) stats.ageBands['30-44']++;
  else if (age < 60) stats.ageBands['45-59']++; else if (age < 80) stats.ageBands['60-79']++; else stats.ageBands['80+']++;
}

function dedupeFresh(records) {
  const best = new Map();
  for (const rec of records) {
    const [suffix, , , , , , , acIdx, fileIdx] = rec;
    const key = `${suffix}/${acIdx}`;
    const partNo = sourceFiles.get(acIdx)?.list?.[fileIdx]?.[1] ?? 0;
    const ex = best.get(key);
    if (!ex || partNo > ex.partNo) best.set(key, { rec, partNo });
  }
  return [...best.values()].map((v) => v.rec);
}

const total = 16 ** shardDepth;
for (let i = 0; i < total; i++) {
  const prefix = i.toString(16).padStart(shardDepth, '0');
  const liveRecs = (await readJson(resolve(LIVE, 'asddo', shardPath(prefix)), null)) ?? null;
  const kept = [];
  if (liveRecs) {
    for (const rec of liveRecs) {
      const acIdx = rec[7];
      const district = districtOfAcIdx(acIdx);
      if (!refreshedDistricts.has(district)) {          // untouched district — preserve verbatim
        kept.push(rec);
        livePreserved.set(district, (livePreserved.get(district) ?? 0) + 1);
        continue;
      }
      const m = acMerge.get(acIdx);
      if (!m) { kept.push(rec); continue; }             // AC had zero fresh booths — preserve the whole AC
      const partNo = m.livePartNo[rec[8]];
      if (m.freshPartNos.has(partNo)) { dropped++; continue; }  // this booth was re-fetched — fresh copy replaces it
      const nf = m.remap.get(rec[8]);                   // failed booth — keep its old data, remap the source-file index
      if (nf === undefined) { dropped++; continue; }
      const kr = rec.slice(); kr[8] = nf;
      kept.push(kr); preservedBooths++;
    }
  }
  let fresh = dedupeFresh(freshShards.get(prefix) ?? []);
  freshShards.delete(prefix);
  if (demotedSet.size) fresh = fresh.filter((rec) => !demotedSet.has(districtOfAcIdx(rec[7])));  // collapsed districts: preserve live, drop fresh
  // Prefer a refreshed booth over a preserved (failed) booth for the same
  // (voter, constituency), so a voter listed in both never appears twice and
  // trips verify-build's duplicate check.
  const freshKeys = new Set(fresh.map((r) => r[0] + '/' + r[7]));
  const merged = kept.filter((r) => !freshKeys.has(r[0] + '/' + r[7])).concat(fresh);
  if (!merged.length) continue;
  bucketCount++;
  merged.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const json = JSON.stringify(merged);
  await writeJson(resolve(OUT, 'asddo', shardPath(prefix)), merged);
  bytes += json.length;
  for (const rec of merged) {
    await tally(rec);
    const [suffix, name, , , , serial, reasonIdx, acIdx, fileIdx] = rec;
    let rows = searchRows.get(acIdx); if (!rows) searchRows.set(acIdx, (rows = []));
    rows.push([fileIdx, serial, name, reasonIdx, prefix + suffix]);
  }
  if (++written % 4000 === 0) progress(`  writing buckets ${written}`);
}
progress('');

// ---- parts: fresh acIdx from memory; preserved acIdx copied from LIVE ---------
await rm(resolve(OUT, 'parts'), { recursive: true, force: true });
for (let acIdx = 0; acIdx < dicts.acs.length; acIdx++) {
  let list;
  if (acMerge.has(acIdx)) list = acMerge.get(acIdx).mergedList;         // fresh booths + preserved failed booths
  else if (sourceFiles.has(acIdx)) list = sourceFiles.get(acIdx).list;  // brand-new AC
  else list = await readJson(resolve(LIVE, 'parts', `${acIdx}.json`), null); // preserved AC
  if (list) await writeJson(resolve(OUT, 'parts', `${acIdx}.json`), list);
}

// ---- search index: sorted per acIdx ------------------------------------------
for (const [acIdx, rows] of searchRows) {
  const list = await partsFor(acIdx);
  const partNoOf = (fileIdx) => list?.[fileIdx]?.[1] ?? 0;
  rows.sort((a, b) => (partNoOf(a[0]) - partNoOf(b[0])) || (a[1] - b[1]));
  await writeJson(resolve(OUT, 'search', `${acIdx}.json`), rows);
}

// ---- BLO + official + manifest + stats ---------------------------------------
const bloByAc = (await readJson(resolve(ROOT, 'seed', 'blo.json'), {})) ?? {};
await rm(resolve(OUT, 'blo'), { recursive: true, force: true });
for (let acIdx = 0; acIdx < dicts.acs.length; acIdx++) {
  const acNo = dicts.acs[acIdx][0];
  const forAc = acNo != null ? bloByAc[acNo] : null;
  if (forAc && Object.keys(forAc).length) await writeJson(resolve(OUT, 'blo', `${acIdx}.json`), forAc);
}
const officialSeed = await readJson(resolve(ROOT, 'seed', 'official-asddo.json'), null);
if (officialSeed?.state) {
  await writeJson(resolve(OUT, 'official.json'), {
    asOf: officialSeed.asOf ?? null, asddo: officialSeed.state.asddo ?? null, electors: officialSeed.state.electors ?? null,
    categories: officialSeed.state.categories ?? {}, source: 'https://ceo.karnataka.gov.in/asddo.html',
    pressRelease: officialSeed.pressRelease ?? null, pressReleaseDate: officialSeed.pressReleaseDate ?? officialSeed.asOf ?? null
  });
}

const dataVersion = Date.now().toString(36);
await writeJson(resolve(OUT, 'manifest.json'), {
  dataVersion, importedAt: new Date().toISOString(), source: 'https://ceo.karnataka.gov.in/asddo.html',
  hash: 'SHA-256', shardDepth, suffixLength, categories: CATEGORIES, dicts,
  hasRoll: live.hasRoll ?? false, hasSearch: true,
  counts: {
    records: stats.total, districts: stats.districts.size,
    districtsInSource: live.counts?.districtsInSource ?? stats.districts.size,
    constituencies: dicts.acs.length, booths: stats.booths.size, buckets: bucketCount
  },
  districtsMissing: live.districtsMissing ?? [],
  mergedFrom: { refreshed: [...refreshedDistricts].sort(), at: new Date().toISOString() }
}, true);

await writeJson(resolve(OUT, 'stats.json'), {
  dataVersion, total: stats.total, byCategory: stats.byCategory, ageBands: stats.ageBands,
  generatedOn: [...stats.generatedOn].sort(),
  districts: [...stats.districts.entries()].map(([name, d]) => ({ name, total: d.total, constituencies: d.acs.size, booths: d.booths.size, ...Object.fromEntries(CATEGORIES.map((c) => [c, d[c]])) })).sort((a, b) => b.total - a.total),
  constituencies: [...stats.acDetail.entries()].map(([acIdx, row]) => { const [no, name, di] = dicts.acs[acIdx]; return { no, name, district: dicts.districts[di], total: row.total, booths: row.booths.size, ...Object.fromEntries(CATEGORIES.map((c) => [c, row[c]])) }; }).sort((a, b) => b.total - a.total),
  topConstituencies: [...stats.acTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([acIdx, t]) => { const [no, name, di] = dicts.acs[acIdx]; return { no, name, district: dicts.districts[di], total: t }; })
}, true);

// ---- SAFETY VERIFICATION: preserved districts must be unchanged ---------------
const liveStats = await readJson(resolve(LIVE, 'stats.json'));
const liveBy = new Map((liveStats?.districts ?? []).map((d) => [d.name, d.total]));
const problems = [];
for (const [name, before] of liveBy) {
  if (refreshedDistricts.has(name)) continue;                    // expected to change
  const after = livePreserved.get(name) ?? 0;
  if (after !== before) problems.push(`${name}: preserved ${after} != live ${before}`);
}
log(`\nMerged: ${stats.total} records | ${stats.districts.size} districts | ${dicts.acs.length} constituencies | ${bucketCount} buckets (${fmtBytes(bytes)})`);
log(`  replaced ${dropped} records with freshly-downloaded booths; kept ${preservedBooths} record(s) from booths that failed to download (old data preserved).`);
if (problems.length) {
  log(`::error::MERGE SAFETY CHECK FAILED — a preserved district changed:`);
  for (const p of problems) log(`  ${p}`);
  process.exit(1);
}
log(`  safety check OK: every preserved district's record count is unchanged from the live build.`);
