/* Plan an INCREMENTAL import: decide which districts actually have to be pulled
 * from the source this run, instead of re-downloading every booth from Drive
 * every time (the full re-crawl is the slow, throttling-prone step that produced
 * the #28 truncation).
 *
 * A district needs extraction when EITHER:
 *   - its source changed since the last run — any booth's file id / zip entry /
 *     generatedOn moved, or a booth was added/removed (compared against the
 *     baseline manifest committed at seed/manifest.json.gz); OR
 *   - it is not already present and COMPLETE in the restored extract cache
 *     (cache/extracted/<slug>.ndjson + <slug>.done) — a cold or partial cache
 *     must be filled, so a first run (or an evicted cache) safely does a full
 *     import rather than publishing a subset.
 *
 * For every district that CHANGED, the stale cached rows are cleared so the
 * booth is re-fetched clean rather than appended to (2-extract appends).
 * Unchanged, already-cached districts are left untouched and reused verbatim.
 *
 * Emits, to $GITHUB_OUTPUT when present (else stdout):
 *   districts   comma-separated names to extract this run ("" if none)
 *   count       how many
 *   mode        "incremental" | "full" (full = cache cold / baseline missing)
 *   reused      how many districts are served from cache untouched
 *
 *   node scripts/plan-incremental.mjs
 */
import { readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { CACHE, ROOT, log } from './lib/common.mjs';

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// One change-signal per booth, keyed by its stable (district, AC, part) position
// — the same key sweep-diff uses, so "changed" means the same thing both places.
function indexBooths(m) {
  const map = new Map();
  for (const d of m.districts ?? []) {
    for (const ac of d.acs ?? []) {
      for (const f of ac.files ?? []) {
        map.set(`${d.name}|${ac.no}|${f.partNo ?? f.name}`, `${f.id ?? f.zipId ?? f.url ?? ''}::${f.entry ?? ''}::${f.generatedOn ?? ''}`);
      }
    }
  }
  return map;
}

const cur = JSON.parse(await readFile(resolve(CACHE, 'manifest.json'), 'utf8'));
const sourceDistricts = (cur.districts ?? []).map((d) => d.name);

let baseline = null;
const basePath = resolve(ROOT, 'seed', 'manifest.json.gz');
if (existsSync(basePath)) {
  try { baseline = JSON.parse(gunzipSync(await readFile(basePath)).toString()); } catch { baseline = null; }
}

const extractedDir = resolve(CACHE, 'extracted');
const cachedComplete = new Set();
try {
  const entries = await readdir(extractedDir);
  const done = new Set(entries.filter((e) => e.endsWith('.done')).map((e) => e.slice(0, -5)));
  const ndjson = new Set(entries.filter((e) => e.endsWith('.ndjson')).map((e) => e.slice(0, -7)));
  for (const s of done) if (ndjson.has(s)) cachedComplete.add(s);
} catch { /* no cache dir yet — cold start */ }

// FORCE_FULL re-pulls every district regardless of source/cache — needed after a
// parser change (e.g. the narrow-table EPIC-wrap fix), where the source is
// unchanged but the rows must be re-parsed. FORCE_DISTRICTS pulls a named subset
// even if unchanged, so a single district can be repaired on demand.
const forceFull = process.env.FORCE_FULL === 'true';
const forceSet = new Set(
  (process.env.FORCE_DISTRICTS ?? '')
    .split(',').map((s) => s.trim().toUpperCase()).filter((s) => s && s !== 'ALL')
);
const mode = forceFull ? 'full-refresh' : baseline ? 'incremental' : 'full';
const curIdx = indexBooths(cur);
const baseIdx = baseline ? indexBooths(baseline) : new Map();

// A district changed if any of its booths appeared, disappeared, or moved.
function districtChanged(name) {
  if (!baseline) return true;
  for (const [k, v] of curIdx) if (k.startsWith(`${name}|`) && baseIdx.get(k) !== v) return true;
  for (const k of baseIdx.keys()) if (k.startsWith(`${name}|`) && !curIdx.has(k)) return true;
  return false;
}

const toExtract = [];
let reused = 0;
for (const name of sourceDistricts) {
  const forced = forceFull || forceSet.has(name.toUpperCase());
  const changed = forced || districtChanged(name);
  const cached = cachedComplete.has(slug(name));
  if (changed || !cached) {
    toExtract.push(name);
    // Clear stale rows for a re-pulled district so the fetch is clean, not
    // appended (2-extract appends to <slug>.ndjson and skips ids in <slug>.done).
    if (changed && cached) {
      await rm(resolve(extractedDir, `${slug(name)}.ndjson`), { force: true });
      await rm(resolve(extractedDir, `${slug(name)}.done`), { force: true });
    }
  } else {
    reused++;
  }
}

log(`Incremental plan (${mode}): ${toExtract.length} district(s) to extract, ${reused} reused from cache.`);
if (toExtract.length) log(`  extract: ${toExtract.join(', ')}`);
if (reused) log(`  reused : ${sourceDistricts.filter((n) => !toExtract.includes(n)).join(', ')}`);

// Extract matrix for the workflow — only the districts to pull this run, longest
// first so the slowest starts earliest. Same shape plan-matrix emits, so the
// extract job consumes it unchanged. Empty include => the extract job is skipped.
const boothCount = (d) => (d.acs ?? []).reduce((n, ac) => n + (ac.files?.length ?? 0), 0);
const byName = new Map((cur.districts ?? []).map((d) => [d.name, d]));
const include = toExtract
  .map((name) => ({ name, slug: slug(name), booths: boothCount(byName.get(name) ?? { acs: [] }) }))
  .sort((a, b) => b.booths - a.booths);

const out = process.env.GITHUB_OUTPUT;
const lines = [
  `matrix=${JSON.stringify({ include })}`,
  `districts=${toExtract.join(',')}`,
  `count=${toExtract.length}`,
  `mode=${mode}`,
  `reused=${reused}`,
  `source_districts=${sourceDistricts.join(',')}`
];
if (out) await (await import('node:fs/promises')).appendFile(out, lines.join('\n') + '\n');
else for (const l of lines) console.log(l);
