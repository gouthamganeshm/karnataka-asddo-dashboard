/* Stage 1 — build the manifest: districts -> assembly constituencies -> booth PDFs.
   Touches only listing pages, downloads no PDFs. Cheap to re-run. */

import { resolve } from 'node:path';
import {
  CACHE, decodeEntities, getText, listDriveFolder, log, pool, progress,
  readJson, writeJson
} from './lib/common.mjs';

const SOURCE = 'https://ceo.karnataka.gov.in/asddo.html';
const MANIFEST = resolve(CACHE, 'manifest.json');

// `--district BELGAUM,KODAGU` limits the crawl. Start small: the full state is
// tens of thousands of PDFs and several hours.
const args = process.argv.slice(2);
const only = argValue('--district')?.split(',').map((s) => s.trim().toUpperCase());

function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

/** The source page is a plain table: district name in one cell, Drive link in another. */
function parseDistricts(html) {
  const districts = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    const link = /href="([^"]*drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)[^"]*)"/i.exec(row);
    if (!link) continue;
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => decodeEntities(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    // [serial, DISTRICT NAME, "Click here to visit"]
    const name = cells.find((c) => /^[A-Z][A-Z .()]{2,}$/.test(c) && !/CLICK/i.test(c));
    if (!name) continue;
    districts.push({ name, folderId: link[2] });
  }
  return districts;
}

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
  log('  If this is a 403/503 or a timeout, the host is refusing this machine');
  log('  rather than being down — some government sites reject datacenter and');
  log('  non-Indian IP ranges, which is what a GitHub runner looks like.');
  log('  Check the preflight step output in the workflow log.');
  process.exit(1);
}
let districts = parseDistricts(html);
log(`Found ${districts.length} districts on ${SOURCE}`);

if (only) {
  districts = districts.filter((d) => only.some((o) => d.name.includes(o)));
  log(`Limited to ${districts.length}: ${districts.map((d) => d.name).join(', ')}`);
}
if (!districts.length) {
  log('Nothing to crawl. Check --district, or the source page layout may have changed.');
  process.exit(1);
}

// Keep whatever we discovered before so a partial crawl can be topped up.
const previous = (await readJson(MANIFEST, { districts: [] })).districts;
const kept = previous.filter((p) => !districts.some((d) => d.name === p.name));

const crawled = [];
for (const district of districts) {
  const acFolders = (await listDriveFolder(district.folderId)).filter((e) => e.isFolder);
  log(`\n${district.name}: ${acFolders.length} constituencies`);

  const acs = await pool(acFolders, 4, async (folder) => {
    const files = (await listDriveFolder(folder.id)).filter(
      (e) => !e.isFolder && /\.pdf$/i.test(e.name)
    );
    // "209 Virajpet" -> number 209, name "Virajpet"
    const parsed = /^(\d+)\s*[-.]?\s*(.+)$/.exec(folder.name);
    return {
      no: parsed ? +parsed[1] : null,
      name: parsed ? parsed[2].trim() : folder.name,
      folderId: folder.id,
      files: files.map((f) => ({ id: f.id, name: f.name, ...parseBoothName(f.name) }))
    };
  }, (done, total) => progress(`  constituencies ${done}/${total}`));

  progress('');
  const parts = acs.reduce((n, ac) => n + (ac.files?.length ?? 0), 0);
  log(`  ${parts} booth PDFs`);
  crawled.push({ ...district, acs });
}

/** `S10_209_100_Govt Higher primary School, Halugunda_01_08_2026_16_23_25.pdf` */
function parseBoothName(fileName) {
  const m = /^([A-Z]\d+)_(\d+)_(\d+)_(.*?)_(\d{2}_\d{2}_\d{4})_(\d{2}_\d{2}_\d{2})\.pdf$/i.exec(fileName);
  if (!m) return { partNo: null, partName: fileName.replace(/\.pdf$/i, '') };
  return {
    stateCode: m[1],
    acNo: +m[2],
    partNo: +m[3],
    partName: m[4].replace(/\s+/g, ' ').trim(),
    generatedOn: m[5].replace(/_/g, '/')
  };
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
    return acc;
  },
  { acs: 0, files: 0 }
);
log(
  `\nManifest written: ${manifest.districts.length} districts, ` +
  `${totals.acs} constituencies, ${totals.files} booth PDFs`
);
log(`  ${MANIFEST}`);
