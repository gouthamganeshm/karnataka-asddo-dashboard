/* Shared helpers for the ingestion pipeline.
   Zero runtime dependencies on purpose: this has to keep working years from
   now on whatever Node the volunteer running it happens to have. */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// ASDDO_CACHE / ASDDO_DOCS redirect the pipeline's input and output, so a test
// can run the real stages over a fixture instead of the live 800 MB tree. This
// is not a convenience: verify-build passed twice on stale local data and then
// failed the same import twice in CI, because nothing could exercise it against
// a controlled case.
export const CACHE = process.env.ASDDO_CACHE ? resolve(process.env.ASDDO_CACHE) : resolve(ROOT, 'cache');
// ASDDO_DOCS redirects a build somewhere other than the published docs/ tree,
// so a partial test build cannot overwrite the live data.
export const DOCS = process.env.ASDDO_DOCS ? resolve(process.env.ASDDO_DOCS) : resolve(ROOT, 'docs');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Fetch with retry + backoff. Returns a Buffer. */
export const get = async (url, opts) => (await getNamed(url, opts)).buf;

/**
 * As `get`, but also returns the name the server gave the file.
 *
 * A Drive link of the form /file/d/<id>/view carries no name at all, and the
 * booth's identity (state, AC, part, timestamp) lives entirely in the file name
 * — so for those the Content-Disposition header is the only way to know what
 * was just downloaded.
 */
export async function getNamed(url, { tries = 4, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'en-IN,en;q=0.9' },
        redirect: 'follow',
        signal: ac.signal
      });
      if (!res.ok) {
        // Carry a snippet of the body: a geo-block, a WAF challenge and a
        // genuine 404 all arrive as a bare status code otherwise, and the
        // difference decides whether re-running could ever help.
        const snippet = (await res.text().catch(() => ''))
          .replace(/\s+/g, ' ')
          .slice(0, 200);
        throw new Error(`HTTP ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      const cd = res.headers.get('content-disposition') ?? '';
      const named = /filename\*=UTF-8''([^;]+)/i.exec(cd) ?? /filename="?([^";]+)"?/i.exec(cd);
      return {
        buf: Buffer.from(await res.arrayBuffer()),
        filename: named ? decodeURIComponent(named[1].trim()) : ''
      };
    } catch (err) {
      lastErr = err;
      // Google throttles hard when you go too fast. Back off, don't hammer.
      if (attempt < tries) await sleep(800 * attempt * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`GET ${url} failed after ${tries} tries: ${lastErr?.message}`);
}

export const getText = async (url, opts) => (await get(url, opts)).toString('utf8');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `worker` over `items` with a fixed concurrency, reporting progress. */
export async function pool(items, concurrency, worker, onProgress) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { error: err.message };
      }
      done++;
      if (onProgress && (done % 25 === 0 || done === items.length)) onProgress(done, items.length);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------------------------------------------------------------- Drive

/**
 * List a public Drive folder without an API key.
 *
 * The normal folder page is JS-rendered and useless to a scraper, but the
 * legacy `embeddedfolderview` endpoint still returns plain HTML with one
 * `flip-entry` div per child.
 */
const parseFolderEntries = (html) => {
  const entries = [];
  const re =
    /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [chunk, id, rawName] = [m[0], m[1], m[2]];
    entries.push({
      id,
      name: decodeEntities(rawName).trim(),
      isFolder: /drive-sprite-folder|aria-label="Folder"/.test(chunk)
    });
  }
  return entries;
};

/**
 * List a Drive folder via embeddedfolderview.
 *
 * The failure this guards: when Drive throttles the folderview request it returns
 * a page with NO flip-entry divs, which parses to []. That is byte-identical to a
 * genuinely empty folder, so a rate-limited constituency folder silently yielded
 * zero booths and the whole constituency vanished from the manifest — different
 * folders on different runs, which is why Vijayanagara/Kolar/Mandya/Tumkur kept
 * coming up short. AC folders are never actually empty, so an empty parse is
 * treated as a throttle and retried with backoff before it is believed.
 */
export async function listDriveFolder(folderId, { tries = 5 } = {}) {
  const url = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`;
  let entries = [];
  for (let attempt = 1; attempt <= tries; attempt++) {
    let html;
    try {
      html = await getText(url, { tries: 2, timeoutMs: 30000 });
    } catch {
      await new Promise((r) => setTimeout(r, 600 * attempt));
      continue;
    }
    entries = parseFolderEntries(html);
    if (entries.length) return entries;
    // Empty — retry a few times with backoff in case it was throttled. If it is
    // still empty after the last attempt, accept it as a real empty folder.
    if (attempt < tries) await new Promise((r) => setTimeout(r, 800 * attempt));
  }
  return entries;
}

export const driveDownloadUrl = (fileId) =>
  `https://drive.google.com/uc?export=download&id=${fileId}`;

export function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ---------------------------------------------------------------- files

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJson(path, value, pretty = false) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value));
}

export const sha256hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function log(...args) {
  process.stdout.write(args.join(' ') + '\n');
}

/** Overwrites the current terminal line — for progress that shouldn't scroll. */
export function progress(msg) {
  if (process.stdout.isTTY) process.stdout.write('\r\x1b[K' + msg);
  else process.stdout.write(msg + '\n');
}
