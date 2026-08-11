/* Stage 5 — the electoral roll index.
 *
 * Source: the CEO publishes the roll as plain CSV, one file per assembly
 * constituency, at
 *
 *     https://ceo.karnataka.gov.in/csv_upload/english/A###.csv
 *     DISTRICT,ACCODE,ACNAME,PART,SLNO,EPIC,FIRST,LAST,RELFIRST,RELLAST,RELATION,AGE,GENDER
 *
 * with polling-booth names in https://ceo.karnataka.gov.in/ac_names.csv.
 * This is what lets the site tell "not deleted" apart from "this number does
 * not exist", and — with details on — show a voter their own roll entry.
 *
 *   node scripts/4-build-roll.mjs                    # all constituencies, with details
 *   node scripts/4-build-roll.mjs --ac 1,2,209       # just these
 *   node scripts/4-build-roll.mjs --existence-only   # publish 4 bytes per EPIC, nothing else
 *
 * TWO THINGS TO UNDERSTAND BEFORE RUNNING THIS WITH DETAILS ON:
 *
 * 1. Coverage. Only ~58% of roll rows carry an EPIC at all. Rows without one
 *    cannot be looked up by EPIC by anyone, us included, and are skipped.
 *
 * 2. Exposure. `--existence-only` publishes 4 bytes of hash per EPIC: no names,
 *    nothing reversible to a person. The default publishes name, relative, age
 *    and gender for every elector who has an EPIC — that is the whole roll,
 *    re-hosted. It is already downloadable from the CEO site, but a copy on
 *    GitHub is mirrorable and permanent in a way the original is not. Choose
 *    deliberately.
 *
 * 3. Vintage (flagged in issue #1). The CEO's `csv_upload/english/A###.csv` and
 *    `ac_names.csv` are an OLD snapshot: their AC codes and names predate
 *    Karnataka's 2008 delimitation, so the constituency numbering here does NOT
 *    match the current SIR/ASDDO rolls. This does not affect the live tool today
 *    — the ASDDO lookup disables the roll (`manifest.hasRoll` is false) and takes
 *    its constituency names from the current SIR PDFs via build-ac-names.mjs —
 *    but the roll index built here would carry stale, mismatched AC numbering.
 *    Switch to a current roll source before ever re-enabling `hasRoll`.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CACHE, DOCS, fmtBytes, get, log, pool, progress, readJson, sha256hex, writeJson
} from './lib/common.mjs';

// NOTE: pre-2008-delimitation vintage — see point 3 in the header. Replace with
// a current roll source before turning `hasRoll` back on.
const CSV_BASE = 'https://ceo.karnataka.gov.in/csv_upload/english';
const PART_NAMES = 'https://ceo.karnataka.gov.in/ac_names.csv';
const ROLL_CACHE = resolve(CACHE, 'roll');
const OUT = resolve(DOCS, 'data');

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const existenceOnly = args.includes('--existence-only');
const onlyAcs = argValue('--ac')?.split(',').map((s) => +s.trim());
const maxAc = Number(argValue('--max-ac') ?? 250);
const concurrency = Number(argValue('--concurrency') ?? 4);
const TARGET_PER_BUCKET = existenceOnly ? 2000 : 300;

await mkdir(ROLL_CACHE, { recursive: true });

// ------------------------------------------------------------ booth names

function unquote(value) {
  const v = (value ?? '').trim();
  return (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v).trim();
}

async function loadPartNames() {
  const path = resolve(ROLL_CACHE, 'ac_names.csv');
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    text = (await get(PART_NAMES)).toString('utf8');
    await writeFile(path, text);
  }
  // AC_NO,AC_NAME,PART_NO,PART_NAME_EN
  const byAc = new Map();
  const acNames = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [acNo, acName, partNo, ...rest] = line.split(',');
    const no = +acNo;
    if (!no) continue;
    if (!byAc.has(no)) byAc.set(no, {});
    // Booth names routinely contain commas and are therefore CSV-quoted:
    //   1,Aurad ,7,"Marathi Boys' Pre-School Room, Pandegaon"
    // Rejoin the split pieces, then unwrap the quoting.
    byAc.get(no)[+partNo] = unquote(rest.join(','));
    if (!acNames.has(no)) acNames.set(no, unquote(acName ?? ''));
  }
  return { byAc, acNames };
}

log('Loading polling-booth names…');
const { byAc: partNames, acNames } = await loadPartNames();
log(`  ${partNames.size} constituencies, ${[...partNames.values()].reduce((n, p) => n + Object.keys(p).length, 0)} booths`);

// ------------------------------------------------------------ fetch the CSVs

const codes = [];
for (let n = 1; n <= maxAc; n++) {
  if (onlyAcs && !onlyAcs.includes(n)) continue;
  codes.push({ n, code: `A${String(n).padStart(3, '0')}` });
}

log(`\nFetching up to ${codes.length} constituency CSVs (concurrency ${concurrency})…`);
let fetched = 0;
let cached = 0;
let missing = 0;

const present = await pool(codes, concurrency, async ({ n, code }) => {
  const path = resolve(ROLL_CACHE, `${code}.csv`);
  try {
    const info = await stat(path);
    if (info.size > 1024) {
      cached++;
      return { n, code, path };
    }
  } catch { /* not cached */ }

  let buf;
  try {
    buf = await get(`${CSV_BASE}/${code}.csv`, { tries: 2 });
  } catch {
    missing++;
    return null;
  }
  // A missing CSV comes back as an HTML error page, not a 404.
  const head = buf.subarray(0, 400).toString('utf8');
  if (/<html|<!doctype/i.test(head) || !head.includes(',')) {
    missing++;
    return null;
  }
  await writeFile(path, buf);
  fetched++;
  return { n, code, path };
}, (done, total) => progress(`  ${done}/${total}  new ${fetched}  cached ${cached}  absent ${missing}`));

progress('');
const acFiles = present.filter(Boolean).filter((x) => x && x.path);
log(`\n${acFiles.length} constituency CSVs available (${fetched} downloaded, ${cached} cached, ${missing} absent)`);
if (!acFiles.length) {
  log('Nothing to build.');
  process.exit(1);
}

// ------------------------------------------------------------ pass 1: count

log('\nCounting electors with an EPIC…');
let totalRows = 0;
let withEpic = 0;
for (const ac of acFiles) {
  const text = await readFile(ac.path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    totalRows++;
    // EPIC is the 6th field; a great many rows simply do not have one.
    const epic = line.split(',')[5]?.trim();
    if (epic && /^[A-Z]{3}[0-9]{7}$/i.test(epic)) withEpic++;
  }
  progress(`  ${ac.code}: ${totalRows} rows, ${withEpic} with EPIC`);
}
progress('');
log(`${totalRows} electors, ${withEpic} with an EPIC (${((withEpic / totalRows) * 100).toFixed(1)}%)`);

const depth = Math.min(4, Math.max(1,
  Math.round(Math.log(withEpic / TARGET_PER_BUCKET) / Math.log(16))
));
log(`Bucket depth ${depth} (${16 ** depth} buckets, ~${Math.round(withEpic / 16 ** depth)} per bucket)`);

// ------------------------------------------------------------ pass 2: build

const relations = [];
const genders = [];
const relIndex = new Map();
const genderIndex = new Map();
const intern = (list, index, value) => {
  if (index.has(value)) return index.get(value);
  const i = list.push(value) - 1;
  index.set(value, i);
  return i;
};

const buckets = new Map();
const acMeta = new Map();
const seenEpics = new Set();
let duplicates = 0;
let built = 0;

const clean = (s) => {
  const v = (s ?? '').trim();
  return !v || v.toUpperCase() === 'NULL' ? '' : v;
};

for (const ac of acFiles) {
  const text = await readFile(ac.path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = line.split(',');
    const epic = clean(f[5]).toUpperCase();
    if (!/^[A-Z]{3}[0-9]{7}$/.test(epic)) continue;

    // The same EPIC can appear twice across parts; keep the first.
    if (seenEpics.has(epic)) { duplicates++; continue; }
    seenEpics.add(epic);

    const hash = await sha256hex(epic);
    const prefix = hash.slice(0, depth);
    if (!buckets.has(prefix)) buckets.set(prefix, []);

    if (existenceOnly) {
      buckets.get(prefix).push(parseInt(hash.slice(depth, depth + 8), 16) >>> 0);
    } else {
      const name = [clean(f[6]), clean(f[7])].filter(Boolean).join(' ');
      const relative = [clean(f[8]), clean(f[9])].filter(Boolean).join(' ');
      buckets.get(prefix).push([
        hash.slice(depth, depth + 8),
        name,
        relative,
        clean(f[10]) ? intern(relations, relIndex, clean(f[10])) : -1,
        +clean(f[11]) || 0,
        clean(f[12]) ? intern(genders, genderIndex, clean(f[12])) : -1,
        ac.n,
        +clean(f[3]) || 0,
        +clean(f[4]) || 0
      ]);
    }

    if (!acMeta.has(ac.n)) {
      acMeta.set(ac.n, [acNames.get(ac.n) || clean(f[2]), clean(f[0])]);
    }
    if (++built % 100000 === 0) progress(`  ${built}/${withEpic}`);
  }
}
progress('');

// ------------------------------------------------------------ write

await rm(resolve(OUT, 'roll'), { recursive: true, force: true });
await rm(resolve(OUT, 'roll-parts'), { recursive: true, force: true });

const bucketPath = (prefix, ext) =>
  prefix.length > 2
    ? [prefix.slice(0, 2), `${prefix.slice(2)}.${ext}`]
    : [`${prefix}.${ext}`];

let bytes = 0;
let written = 0;
for (const [prefix, records] of buckets) {
  const path = resolve(OUT, 'roll', ...bucketPath(prefix, existenceOnly ? 'bin' : 'json'));
  await mkdir(resolve(path, '..'), { recursive: true });
  if (existenceOnly) {
    records.sort((a, b) => a - b);
    const buf = Buffer.alloc(records.length * 4);
    records.forEach((v, i) => buf.writeUInt32BE(v, i * 4));
    await writeFile(path, buf);
    bytes += buf.length;
  } else {
    records.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const json = JSON.stringify(records);
    await writeFile(path, json);
    bytes += json.length;
  }
  if (++written % 500 === 0) progress(`  writing ${written}/${buckets.size}`);
}
progress('');

if (!existenceOnly) {
  for (const [acNo] of acMeta) {
    const parts = partNames.get(acNo);
    if (parts) await writeJson(resolve(OUT, 'roll-parts', `${acNo}.json`), parts);
  }
  await writeJson(resolve(OUT, 'roll-meta.json'), {
    relations,
    genders,
    acs: Object.fromEntries(acMeta)
  });
}

const manifestPath = resolve(OUT, 'manifest.json');
const manifest = await readJson(manifestPath);
if (!manifest) {
  log('docs/data/manifest.json missing. Run `npm run build` first.');
  process.exit(1);
}
await writeJson(manifestPath, {
  ...manifest,
  hasRoll: true,
  rollHasDetails: !existenceOnly,
  rollShardDepth: depth,
  rollSuffixLength: 8,
  rollCount: seenEpics.size,
  rollConstituencies: acMeta.size,
  rollCoverage: +((withEpic / totalRows) * 100).toFixed(1),
  rollImportedAt: new Date().toISOString()
}, true);

log(`\nWrote ${buckets.size} roll buckets (${fmtBytes(bytes)})${existenceOnly ? ' — existence only' : ' with elector details'}`);
log(`  ${seenEpics.size} EPICs indexed across ${acMeta.size} constituencies (${duplicates} duplicate EPICs skipped)`);
log(`  ${(100 - (withEpic / totalRows) * 100).toFixed(1)}% of roll rows have no EPIC and cannot be looked up by anyone.`);
if (!existenceOnly && bytes > 900_000_000) {
  log('\n  WARNING: over ~900 MB. GitHub Pages caps a published site at 1 GB.');
  log('  Either publish docs/data/roll to its own repo/site, or re-run with --existence-only.');
}
