/* One way in to any archive the districts publish.
 *
 * They publish three shapes: a .zip of booth PDFs, a .rar of booth PDFs, and —
 * Kudligi — a .zip whose only member is a .rar of booth PDFs. Callers should
 * not have to know which; they ask for the PDFs inside and get them.
 */

import { listZipEntries, looksZip } from './zip.mjs';
import { list7zEntries, listRarEntries, looks7z, looksRar } from './rar.mjs';

const IS_ARCHIVE = /\.(zip|rar|7z)$/i;
const IS_PDF = /\.pdf$/i;

/**
 * Entries of an archive held in a Buffer, descending through nesting.
 *
 * @param {Buffer} buf
 * @param {number} depth guard against an archive that contains itself
 * @returns {{name: string, size: number, read: () => Buffer}[]}
 * @throws if the bytes are neither zip nor rar, or no RAR extractor exists
 */
export function openArchiveBuffer(buf, depth = 0) {
  let entries;
  if (looksZip(buf)) entries = listZipEntries(buf);
  else if (looksRar(buf)) entries = listRarEntries(buf);
  else if (looks7z(buf)) entries = list7zEntries(buf);
  else throw new Error(`not an archive (${JSON.stringify(buf.subarray(0, 4).toString('latin1'))})`);

  if (depth >= 3) return entries;

  // Only descend when the outer archive holds no documents of its own. A .zip
  // that is just a wrapper around a .rar is otherwise indistinguishable from an
  // empty district, which is how Kudligi's 250 booths stayed missing.
  if (entries.some((e) => IS_PDF.test(e.name))) return entries;

  const nested = entries.filter((e) => IS_ARCHIVE.test(e.name));
  if (!nested.length) return entries;

  const out = [];
  for (const entry of nested) out.push(...openArchiveBuffer(entry.read(), depth + 1));
  return out;
}
