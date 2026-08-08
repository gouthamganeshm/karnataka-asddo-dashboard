/* RAR reader, for the one district that ships its booth lists that way.
 *
 * Vijayanagara publishes Kudligi as a .zip containing a .rar containing 250
 * booth PDFs. RAR5 uses a proprietary compression that zlib cannot touch and
 * that is not worth reimplementing, so this shells out to whichever extractor
 * the machine has. That keeps the project dependency-free at install time and
 * costs one apt line in CI.
 *
 * The archive is extracted to a temporary directory, read into memory, and the
 * directory is deleted before this returns — matching the rest of the pipeline,
 * where source documents are never left on disk. 250 PDFs is ~34 MB, which is
 * nothing next to what a district's extract already streams.
 *
 * Returns the same shape as listZipEntries, so callers treat both alike.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

/** `x` extracts with paths; each tool spells "output directory" differently. */
const TOOLS = [
  { cmd: '7zz', args: (a, d) => ['x', a, `-o${d}`, '-y'] },
  { cmd: '7z', args: (a, d) => ['x', a, `-o${d}`, '-y'] },
  { cmd: 'unar', args: (a, d) => [a, '-o', d, '-f'] },
  { cmd: 'unrar', args: (a, d) => ['x', '-y', a, d] },
  // 7-Zip on Windows installs outside PATH more often than not.
  { cmd: 'C:\\Program Files\\7-Zip\\7z.exe', args: (a, d) => ['x', a, `-o${d}`, '-y'] },
  { cmd: 'C:\\Program Files (x86)\\7-Zip\\7z.exe', args: (a, d) => ['x', a, `-o${d}`, '-y'] }
];

let cached;

/** The first extractor on this machine that actually runs, or null. */
export function findRarTool() {
  if (cached !== undefined) return cached;
  for (const tool of TOOLS) {
    try {
      if (tool.cmd.includes(sep) && !existsSync(tool.cmd)) continue;
      // `unar` exits non-zero with no arguments, so ask for the version.
      execFileSync(tool.cmd, [tool.cmd === 'unar' ? '-v' : '--help'], { stdio: 'ignore', timeout: 15000 });
      cached = tool;
      return cached;
    } catch {
      // A tool that is present but refuses --help can still extract; only a
      // missing binary throws ENOENT.
      if (existsSync(tool.cmd)) { cached = tool; return cached; }
    }
  }
  cached = null;
  return cached;
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

/**
 * List the entries of a RAR held in a Buffer.
 * @returns {{name: string, size: number, read: () => Buffer}[]}
 * @throws if no extractor is installed — the caller reports that rather than
 *         silently returning an empty district.
 */
export function listRarEntries(buf) {
  const tool = findRarTool();
  if (!tool) {
    throw new Error('no RAR extractor found (install one of: 7zz, 7z, unar, unrar)');
  }

  const dir = mkdtempSync(join(tmpdir(), 'asddo-rar-'));
  try {
    const archive = join(dir, 'archive.rar');
    writeFileSync(archive, buf);
    const out = join(dir, 'out');
    execFileSync(tool.cmd, tool.args(archive, out), { stdio: 'ignore', timeout: 300000 });

    return walk(out).map((path) => {
      const bytes = readFileSync(path);
      return {
        name: relative(out, path).split(sep).join('/'),
        size: bytes.length,
        read: () => bytes
      };
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const looksRar = (buf) =>
  buf.length > 8 && buf.subarray(0, 4).toString('latin1') === 'Rar!';
