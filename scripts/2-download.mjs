/* Stage 2 — download every booth PDF named in the manifest.
   Resumable: anything already in cache/pdfs is skipped, so an interrupted run
   costs nothing. This is the slow stage; everything after it is local. */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CACHE, driveDownloadUrl, fmtBytes, get, log, pool, progress, readJson } from './lib/common.mjs';

const PDF_DIR = resolve(CACHE, 'pdfs');
const args = process.argv.slice(2);
const only = argValue('--district')?.split(',').map((s) => s.trim().toUpperCase());
// Google starts throttling around 8 parallel fetches. 5 is a polite default.
const concurrency = Number(argValue('--concurrency') ?? 5);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

const manifest = await readJson(resolve(CACHE, 'manifest.json'));
if (!manifest) {
  log('No manifest. Run `npm run discover` first.');
  process.exit(1);
}

await mkdir(PDF_DIR, { recursive: true });

const jobs = [];
for (const district of manifest.districts) {
  if (only && !only.some((o) => district.name.includes(o))) continue;
  for (const ac of district.acs) {
    for (const file of ac.files) jobs.push({ id: file.id, name: file.name });
  }
}
log(`${jobs.length} booth PDFs queued (concurrency ${concurrency})`);

let downloaded = 0;
let skipped = 0;
let failed = 0;
let bytes = 0;

await pool(
  jobs,
  concurrency,
  async (job) => {
    const path = resolve(PDF_DIR, `${job.id}.pdf`);
    try {
      const existing = await stat(path);
      if (existing.size > 1024) {
        skipped++;
        return;
      }
    } catch {
      /* not cached yet */
    }

    const buf = await get(driveDownloadUrl(job.id));
    // A throttle or a permissions change gives back an HTML page, not a PDF.
    if (buf.subarray(0, 4).toString('latin1') !== '%PDF') {
      failed++;
      return;
    }
    await writeFile(path, buf);
    downloaded++;
    bytes += buf.length;
  },
  (done, total) =>
    progress(
      `  ${done}/${total}  new ${downloaded}  cached ${skipped}  failed ${failed}  ${fmtBytes(bytes)}`
    )
);

progress('');
log(`\nDone. ${downloaded} downloaded, ${skipped} already cached, ${failed} failed.`);
if (failed) log('Re-run this command — failures are usually Drive throttling and clear on retry.');
