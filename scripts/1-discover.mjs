/* Stage 1 — build the manifest: districts -> assembly constituencies -> booth PDFs.
   Touches only listing pages, downloads no PDFs. Cheap to re-run.

   The source page lists 34 districts and publishes them three different ways:

     - most link straight to a Google Drive folder;
     - ten link to the district's own *.nic.in site, which then links on to
       Drive folders (and sometimes to PDFs hosted on nic.in itself);
     - the Drive trees themselves are not a consistent shape. Some are
       district -> AC -> PDFs, others district -> AC -> date -> PDFs, others
       wrap everything in a redundant folder of the same name.

   On top of that, two districts publish a whole taluk as a single .zip of booth
   PDFs rather than a folder of loose files. Matching only *.pdf found nothing
   there and dropped Vijayanagara — ~1,000 booths — out of the site without a
   single error, so archives are opened here and their entries treated as
   ordinary booths.

   So nothing here assumes a shape. Drive folders are walked recursively until
   PDFs turn up, and the booth's identity is taken from the file name, which
   carries state, AC, part and generation timestamp:

       S10_209_100_Govt Higher primary School, Halugunda_01_08_2026_16_23_25.pdf

   That timestamp is what makes the dated folders safe: the same booth appears
   under several dates, and the newest wins. An earlier version of this script
   assumed district -> AC -> PDFs and silently returned zero files for five
   districts while dropping ten more for not being on Drive at all. */

import { resolve } from 'node:path';
import {
  CACHE, ROOT, decodeEntities, driveDownloadUrl, get, getNamed, getText, listDriveFolder, log,
  pool, progress, readJson, writeJson
} from './lib/common.mjs';
import { isNotBoothList, parseBoothName } from './lib/naming.mjs';
import { looksZip } from './lib/zip.mjs';
import { looksRar, looks7z } from './lib/rar.mjs';
import { openArchiveBuffer } from './lib/archive.mjs';

const SOURCE = 'https://ceo.karnataka.gov.in/asddo.html';
// Districts that publish across more than one Drive folder, where asddo.html
// links only one. See seed/extra-sources.json.
const EXTRA = (await readJson(resolve(ROOT, 'seed', 'extra-sources.json'), { districts: {} }))?.districts ?? {};
const MANIFEST = resolve(CACHE, 'manifest.json');
const MAX_DEPTH = 5;

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const only = argValue('--district')?.split(',').map((s) => s.trim().toUpperCase());

// --------------------------------------------------------------- source page

/** Every district row, whatever it links to. */
function parseDistricts(html) {
  const districts = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    const link = /href="(https?:\/\/[^"]+)"/i.exec(row);
    if (!link) continue;

    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => decodeEntities(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const name = cells.find((c) => /^[A-Z][A-Z .()]{2,}$/.test(c) && !/CLICK/i.test(c));
    if (!name) continue;

    const url = link[1];
    const drive = /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/i.exec(url);
    districts.push({
      name,
      // A district is either a Drive root or a page that points at some.
      folderId: drive ? drive[1] : null,
      pageUrl: drive ? null : url
    });
  }
  return districts;
}

/** A district hosted on its own nic.in site: find what it points at. */
async function resolveDistrictPage(url) {
  let html;
  try {
    // These nic.in hosts 504 intermittently and recover minutes later --
    // Bangalore Rural looked permanently dead on that basis for weeks, and one
    // crawl lost Chikkaballapur and Mandya the same way. There are only ten of
    // these pages in the whole run, so retrying hard costs seconds and is the
    // difference between a district being imported and being dropped. It
    // matters more now that an empty district fails the import outright.
    html = await getText(url, { tries: 5, timeoutMs: 30000 });
  } catch (err) {
    return { folderIds: [], pdfs: [], error: err.message };
  }
  const base = new URL(url);

  // Bangalore Rural's links were pasted out of webmail, so every one of them is
  // wrapped in mail.mgovcloud.in/zm/reUrlCheck.do?url=<percent-encoded>. The
  // literal string "drive.google.com/drive/folders/" never appears in the HTML,
  // so matching the raw markup found nothing and the district looked empty.
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => {
    const raw = decodeEntities(m[1]);
    const wrapped = /[?&]url=([^&"]+)/.exec(raw);
    if (!wrapped) return raw;
    try { return decodeURIComponent(wrapped[1]); } catch { return raw; }
  });

  const folderIds = [
    ...new Set(
      hrefs.flatMap((h) =>
        [...h.matchAll(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/gi)].map((m) => m[1])
      )
    )
  ];

  // A Drive file link carries no extension, so it matches neither the .pdf nor
  // the .zip patterns below. What it points at is decided by sniffing the bytes.
  const driveFileIds = [
    ...new Set(
      hrefs.flatMap((h) => [...h.matchAll(/drive\.google\.com\/file\/d\/([\w-]+)/gi)].map((m) => m[1]))
    )
  ];
  const abs = (h) => { try { return new URL(h, base).href; } catch { return null; } };
  const bySuffix = (re) =>
    [...new Set(hrefs.filter((h) => re.test(h) && !/drive\.google\.com/i.test(h)).map(abs).filter(Boolean))];

  const pdfs = bySuffix(/\.pdf$/i);
  // Same reason as on the Drive side: a district may hand out an archive rather
  // than loose PDFs, and matching only .pdf loses it entirely. .rar counts too —
  // openArchiveBuffer reads both, and some districts publish a taluk as a .rar.
  const zips = bySuffix(/\.(zip|rar|7z)$/i);

  return { folderIds, driveFileIds, pdfs, zips, error: null };
}

// ------------------------------------------------------------------- drive

// Notes about archives that could not be opened, surfaced at the end of the run
// so a district never disappears silently the way Vijayanagara did.
const archiveNotes = [];

/**
 * Some districts publish a whole taluk as one .zip of booth PDFs instead of a
 * Drive folder of loose files. Open it here, at discovery time, so the manifest
 * describes real booths — the archives are a few MB each, and only the entry
 * list is kept.
 *
 * Each entry becomes an ordinary file record carrying `zipId` + `entry`, which
 * is all stage 2 needs to pull that one PDF back out. The booth's identity still
 * comes from its file name inside the archive, which follows the same
 * S10_<ac>_<part>_<name>_<timestamp> convention as the loose files.
 */
async function expandArchive(file, trail, prefetched = null) {
  let buf = prefetched;
  try {
    buf ??= await get(file.url ?? driveDownloadUrl(file.id));
  } catch (err) {
    archiveNotes.push(`${file.name}: could not fetch (${err.message})`);
    return [];
  }
  let entries;
  try {
    entries = openArchiveBuffer(buf);
  } catch (err) {
    archiveNotes.push(`${file.name}: ${err.message}`);
    return [];
  }

  const out = [];
  let other = 0;
  for (const entry of entries) {
    const base = entry.name.split('/').pop();
    if (!/\.pdf$/i.test(base)) { other++; continue; }
    if (isNotBoothList(base)) continue;
    out.push({
      id: null,
      zipId: file.id ?? null,
      zipUrl: file.url ?? null,
      entry: entry.name,
      name: base,
      trail: [...trail, file.name]
    });
  }
  // Anything left that holds no booth PDFs at all: name what is inside it,
  // rather than reporting an empty district and letting it disappear.
  if (!out.length && other) {
    archiveNotes.push(
      `${file.name}: holds no PDFs, only ${entries.map((e) => e.name.split('/').pop()).join(', ')}`
    );
  }
  return out;
}

/**
 * A district page can link a Drive *file* directly, with no extension in the
 * URL and no name anywhere in the markup. Fetch it, take the name from the
 * response, and decide from the bytes whether it is a booth PDF or an archive
 * of them.
 */
async function resolveDriveFile(id, trail) {
  let buf, filename;
  try {
    ({ buf, filename } = await getNamed(driveDownloadUrl(id)));
  } catch (err) {
    archiveNotes.push(`drive file ${id}: could not fetch (${err.message})`);
    return [];
  }

  const name = filename || id;
  if (isNotBoothList(name)) return [];

  if (looksZip(buf) || looksRar(buf) || looks7z(buf)) return expandArchive({ id, name }, trail, buf);
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') {
    return [{ id, name, trail }];
  }
  archiveNotes.push(`drive file ${id} (${name}): neither a PDF nor an archive (zip/rar/7z)`);
  return [];
}

/** Walk a Drive folder to any depth, collecting every PDF with its folder trail. */
async function collectPdfs(folderId, trail = [], depth = 0, seen = new Set()) {
  if (depth > MAX_DEPTH || seen.has(folderId)) return [];
  seen.add(folderId);

  let entries;
  try {
    entries = await listDriveFolder(folderId);
  } catch {
    return [];
  }

  const out = [];
  const folders = entries.filter((e) => e.isFolder);
  for (const file of entries) {
    if (file.isFolder || isNotBoothList(file.name)) continue;
    if (/\.pdf$/i.test(file.name)) {
      out.push({ id: file.id, name: file.name, trail });
    } else if (/\.(zip|rar|7z)$/i.test(file.name)) {
      out.push(...await expandArchive(file, trail));
    }
  }
  for (const folder of folders) {
    out.push(...await collectPdfs(folder.id, [...trail, folder.name], depth + 1, seen));
  }
  return out;
}


/**
 * Nearest ancestor folder that looks like "26 Muddebihal" / "221-AC Hanuru".
 *
 * Districts also nest by date, and "31-07-2026" matches that shape perfectly —
 * which invented a constituency 31 named "07-2026" and mis-filed Muddebihal's
 * booths under it. So date-shaped folders are rejected outright, and the
 * remaining label must contain real letters to count as a name.
 */
function acFromTrail(trail, acNo) {
  for (let i = trail.length - 1; i >= 0; i--) {
    const entry = trail[i].trim();

    // dd-mm-yyyy, dd_mm_yyyy, mm-yyyy, and the same with a "Final" suffix.
    if (/^\d{1,2}[-_./]\d{1,2}[-_./]\d{2,4}\b/.test(entry)) continue;
    if (/^\d{1,2}[-_./]\d{4}\b/.test(entry)) continue;

    const m = /^(\d{1,3})\s*[-.]?\s*(?:AC[\s-]*)?(.+)$/i.exec(entry);
    if (!m) continue;

    const no = +m[1];
    // Karnataka has 224 assembly constituencies; anything outside that is not one.
    if (no < 1 || no > 224) continue;
    if (acNo != null && no !== acNo) continue;

    // The trail can end at an archive ("104 HRP ASSDO List.zip"), so drop any
    // extension before it becomes a constituency name.
    const label = m[2]
      .replace(/\.(zip|rar|7z|pdf)$/i, '')
      .replace(/\bASDD?O?\b.*$/i, '')
      .replace(/[\s._-]+$/, '')
      .trim();
    // "07-2026" leaves no letters behind; a constituency name has some.
    if (!/[A-Za-z]{3}/.test(label)) continue;
    return { no, name: label };
  }
  return null;
}

/**
 * Group a district's PDFs into constituencies, keeping one copy per booth.
 *
 * Districts that publish a folder per day hold the same booth many times over;
 * the file name's generation timestamp decides which survives.
 */
function groupIntoAcs(files) {
  const best = new Map();
  for (const file of files) {
    const parsed = parseBoothName(file.name);
    const fromTrail = acFromTrail(file.trail, parsed.acNo);
    const acNo = parsed.acNo ?? fromTrail?.no ?? null;
    const key = acNo != null && parsed.partNo != null
      ? `${acNo}/${parsed.partNo}`
      : `name:${file.name}`;

    const candidate = { ...file, ...parsed, acNo, acName: fromTrail?.name ?? null };
    const existing = best.get(key);
    if (!existing || candidate.stamp > existing.stamp) best.set(key, candidate);
  }

  const acs = new Map();
  for (const file of best.values()) {
    const no = file.acNo ?? 0;
    if (!acs.has(no)) acs.set(no, { no: no || null, name: file.acName ?? `AC ${no || '?'}`, files: [] });
    const ac = acs.get(no);
    if (!ac.name || /^AC /.test(ac.name)) ac.name = file.acName ?? ac.name;
    ac.files.push({
      id: file.id,
      url: file.url ?? null,
      // Set only for a booth that lives inside an archive; stage 2 fetches the
      // archive once and reads this entry out of it.
      ...(file.zipId || file.zipUrl
        ? { zipId: file.zipId ?? null, zipUrl: file.zipUrl ?? null, entry: file.entry }
        : {}),
      name: file.name,
      acNo: file.acNo,
      partNo: file.partNo,
      partName: file.partName,
      generatedOn: file.generatedOn ?? ''
    });
  }
  return [...acs.values()].sort((a, b) => (a.no ?? 0) - (b.no ?? 0));
}

// --------------------------------------------------------------------- run

let html;
try {
  // Short and few: when this host drops packets from a datacenter it hangs
  // rather than refusing, and the caller has a committed manifest to fall back
  // on. Four 60s attempts would just delay that by four minutes.
  html = await getText(SOURCE, { tries: 2, timeoutMs: 20000 });
} catch (err) {
  log(`Could not fetch ${SOURCE}`);
  log(`  ${err.message}`);
  log('');
  log('  ON A GITHUB RUNNER THIS IS EXPECTED, AND NOT A BROKEN BUILD.');
  log('  ceo.karnataka.gov.in does not answer GitHub IP ranges — "fetch failed"');
  log('  with no status code means the connection never completed, rather than');
  log('  the site being down. It responds normally from an ordinary connection.');
  log('');
  log('  The workflow reads the non-zero exit below as its cue to run the');
  log('  "Fall back to the committed manifest" step, which loads');
  log('  seed/manifest.json.gz and carries on. Check that the next step ran.');
  log('');
  log('  Running this locally instead? Then the host really is unreachable from');
  log('  here: check connectivity, or refresh the seed from a machine that can');
  log('  reach it.');
  process.exit(1);
}

let districts = parseDistricts(html);
log(`Found ${districts.length} districts on ${SOURCE}`);
log(`  ${districts.filter((d) => d.folderId).length} link straight to Drive, ` +
    `${districts.filter((d) => d.pageUrl).length} via their own district site`);

if (only) {
  districts = districts.filter((d) => only.some((o) => d.name.includes(o)));
  log(`Limited to ${districts.length}: ${districts.map((d) => d.name).join(', ')}`);
}
if (!districts.length) {
  log('Nothing to crawl. Check --district, or the source page layout may have changed.');
  process.exit(1);
}

const previous = (await readJson(MANIFEST, { districts: [] })).districts;
const kept = previous.filter((p) => !districts.some((d) => d.name === p.name));

const crawled = [];
const problems = [];

for (const district of districts) {
  let roots = [];
  let directPdfs = [];

  let directZips = [];
  let driveFileIds = [];

  if (district.folderId) {
    roots = [district.folderId];
  } else {
    const resolved = await resolveDistrictPage(district.pageUrl);
    roots = resolved.folderIds;
    directPdfs = resolved.pdfs;
    directZips = resolved.zips ?? [];
    driveFileIds = resolved.driveFileIds ?? [];
    if (resolved.error) problems.push(`${district.name}: ${resolved.error}`);
  }

  // A district can publish across several folders; the state page links one.
  const extra = EXTRA[district.name] ?? [];
  for (const e of extra) if (e.folderId && !roots.includes(e.folderId)) roots.push(e.folderId);
  if (extra.length) log(`  ${district.name}: +${extra.length} extra source folder(s) from seed/extra-sources.json`);

  progress(`  ${district.name}: walking ${roots.length} Drive folder(s)…`);
  const found = [];
  const seen = new Set();
  for (const root of roots) found.push(...await collectPdfs(root, [], 0, seen));

  // PDFs served by the district site itself, not Drive.
  for (const url of directPdfs) {
    found.push({ id: null, url, name: decodeURIComponent(url.split('/').pop()), trail: [] });
  }
  for (const url of directZips) {
    found.push(...await expandArchive({ url, name: decodeURIComponent(url.split('/').pop()) }, []));
  }
  // Skip any file already reached by walking a folder above — several districts
  // link the same document both ways.
  const alreadyFound = new Set(found.flatMap((f) => [f.id, f.zipId].filter(Boolean)));
  for (const id of driveFileIds) {
    if (alreadyFound.has(id)) continue;
    found.push(...await resolveDriveFile(id, []));
  }

  const acs = groupIntoAcs(found);
  const total = acs.reduce((n, ac) => n + ac.files.length, 0);
  progress('');
  log(`${district.name}: ${acs.length} constituencies, ${total} booth PDFs` +
      (found.length !== total ? `  (${found.length - total} duplicate/older copies dropped)` : ''));
  if (!total) problems.push(`${district.name}: no PDFs found`);

  crawled.push({ name: district.name, folderId: district.folderId, pageUrl: district.pageUrl, acs });
}

const allDistricts = [...kept, ...crawled].sort((a, b) => a.name.localeCompare(b.name));
const emptyDistricts = allDistricts
  .filter((d) => !d.acs.some((ac) => ac.files.length))
  .map((d) => d.name);

const manifest = {
  source: SOURCE,
  discoveredAt: new Date().toISOString(),
  // Recorded rather than merely logged, because a district that yields nothing
  // is exactly the failure that has twice reached the live site unnoticed:
  // downstream steps filtered these out before counting, so "all districts
  // imported" was true of a set that had already lost them. Every later stage
  // now has the source's own number to check against.
  coverage: {
    districtsInSource: allDistricts.length,
    districtsWithData: allDistricts.length - emptyDistricts.length,
    empty: emptyDistricts,
    unreadable: archiveNotes
  },
  districts: allDistricts
};
await writeJson(MANIFEST, manifest, true);

const totals = manifest.districts.reduce(
  (acc, d) => {
    acc.acs += d.acs.length;
    acc.files += d.acs.reduce((n, ac) => n + ac.files.length, 0);
    if (d.acs.some((ac) => ac.files.length)) acc.withData++;
    return acc;
  },
  { acs: 0, files: 0, withData: 0 }
);

log(`\nManifest: ${manifest.districts.length} districts ` +
    `(${totals.withData} with data), ${totals.acs} constituencies, ${totals.files} booth PDFs`);
log(`  ${MANIFEST}`);
if (archiveNotes.length) {
  log(`\n  ${archiveNotes.length} archive(s) could not be opened:`);
  for (const n of archiveNotes) log(`    ${n}`);
}
if (problems.length) {
  log(`\n  ${problems.length} district(s) need attention:`);
  for (const p of problems) log(`    ${p}`);
}
if (emptyDistricts.length) {
  log(`\n  ${emptyDistricts.length} of ${allDistricts.length} districts yielded no booth PDFs:`);
  for (const name of emptyDistricts) log(`    ${name}`);
  log('  Importing without them narrows the site\'s coverage. Fix the crawl, or');
  log('  run the import with allow_partial=true to accept the gap deliberately.');
}
