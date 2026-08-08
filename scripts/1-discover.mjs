/* Stage 1 — build the manifest: districts -> assembly constituencies -> booth PDFs.
   Touches only listing pages, downloads no PDFs. Cheap to re-run.

   The source page lists 34 districts and publishes them three different ways:

     - most link straight to a Google Drive folder;
     - ten link to the district's own *.nic.in site, which then links on to
       Drive folders (and sometimes to PDFs hosted on nic.in itself);
     - the Drive trees themselves are not a consistent shape. Some are
       district -> AC -> PDFs, others district -> AC -> date -> PDFs, others
       wrap everything in a redundant folder of the same name.

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
  CACHE, decodeEntities, getText, listDriveFolder, log, pool, progress,
  readJson, writeJson
} from './lib/common.mjs';

const SOURCE = 'https://ceo.karnataka.gov.in/asddo.html';
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
    html = await getText(url, { tries: 2, timeoutMs: 30000 });
  } catch (err) {
    return { folderIds: [], pdfs: [], error: err.message };
  }
  const base = new URL(url);
  const folderIds = [
    ...new Set(
      [...html.matchAll(/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)/gi)]
        .map((m) => m[1])
    )
  ];
  const pdfs = [
    ...new Set(
      [...html.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => new URL(decodeEntities(m[1]), base).href)
    )
  ];
  return { folderIds, pdfs, error: null };
}

// ------------------------------------------------------------------- drive

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
    if (!file.isFolder && /\.pdf$/i.test(file.name)) out.push({ id: file.id, name: file.name, trail });
  }
  for (const folder of folders) {
    out.push(...await collectPdfs(folder.id, [...trail, folder.name], depth + 1, seen));
  }
  return out;
}

/** `S10_209_100_Govt Higher primary School, Halugunda_01_08_2026_16_23_25.pdf` */
function parseBoothName(fileName) {
  const m = /^([A-Z]\d+)_(\d+)_(\d+)_(.*?)_(\d{2}_\d{2}_\d{4})_(\d{2}_\d{2}_\d{2})\.pdf$/i.exec(fileName);
  if (!m) return { partNo: null, partName: fileName.replace(/\.pdf$/i, ''), stamp: 0 };
  const [dd, mm, yyyy] = m[5].split('_');
  const [hh, mi, ss] = m[6].split('_');
  return {
    stateCode: m[1],
    acNo: +m[2],
    partNo: +m[3],
    partName: m[4].replace(/\s+/g, ' ').trim(),
    generatedOn: m[5].replace(/_/g, '/'),
    // Sortable instant, so the freshest copy of a booth wins.
    stamp: Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`) || 0
  };
}

/** Nearest ancestor folder that looks like "26 Muddebihal" / "221-AC Hanuru". */
function acFromTrail(trail, acNo) {
  for (let i = trail.length - 1; i >= 0; i--) {
    const m = /^(\d{1,3})\s*[-.]?\s*(?:AC[\s-]*)?(.+)$/i.exec(trail[i].trim());
    if (!m) continue;
    if (acNo != null && +m[1] !== acNo) continue;
    const label = m[2].replace(/\bASDD?O?\b.*$/i, '').replace(/[\s._-]+$/, '').trim();
    if (label) return { no: +m[1], name: label };
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

  if (district.folderId) {
    roots = [district.folderId];
  } else {
    const resolved = await resolveDistrictPage(district.pageUrl);
    roots = resolved.folderIds;
    directPdfs = resolved.pdfs;
    if (resolved.error) problems.push(`${district.name}: ${resolved.error}`);
  }

  progress(`  ${district.name}: walking ${roots.length} Drive folder(s)…`);
  const found = [];
  const seen = new Set();
  for (const root of roots) found.push(...await collectPdfs(root, [], 0, seen));

  // PDFs served by the district site itself, not Drive.
  for (const url of directPdfs) {
    found.push({ id: null, url, name: decodeURIComponent(url.split('/').pop()), trail: [] });
  }

  const acs = groupIntoAcs(found);
  const total = acs.reduce((n, ac) => n + ac.files.length, 0);
  progress('');
  log(`${district.name}: ${acs.length} constituencies, ${total} booth PDFs` +
      (found.length !== total ? `  (${found.length - total} duplicate/older copies dropped)` : ''));
  if (!total) problems.push(`${district.name}: no PDFs found`);

  crawled.push({ name: district.name, folderId: district.folderId, pageUrl: district.pageUrl, acs });
}

const manifest = {
  source: SOURCE,
  discoveredAt: new Date().toISOString(),
  districts: [...kept, ...crawled].sort((a, b) => a.name.localeCompare(b.name))
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
if (problems.length) {
  log(`\n  ${problems.length} district(s) need attention:`);
  for (const p of problems) log(`    ${p}`);
}
