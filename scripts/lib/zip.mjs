/* Minimal in-memory ZIP reader.
 *
 * Two districts publish their ASDDO lists as one .zip per taluk rather than as
 * loose PDFs in a Drive folder, so without this the crawl finds nothing there
 * and the district silently drops out of the site. The archives are small
 * (2-6 MB each) and hold ordinary deflated PDFs.
 *
 * Deliberately dependency-free and buffer-only, to match the rest of the
 * pipeline: the archive is streamed, opened in memory, and discarded. Nothing
 * is unpacked to disk.
 *
 * Reads the central directory rather than scanning for local headers, because
 * only the central directory is authoritative about entry sizes.
 */

import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** Locate the end-of-central-directory record, scanning back over any comment. */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * List the entries of a ZIP held in a Buffer.
 * @returns {{name: string, size: number, read: () => Buffer}[]} directories and
 *   empty entries omitted; `read()` inflates that entry on demand.
 */
export function listZipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd === -1) throw new Error('not a zip (no end-of-central-directory record)');

  let count = buf.readUInt16LE(eocd + 10);
  let dirOffset = buf.readUInt32LE(eocd + 16);

  // Zip64: the 32-bit fields saturate and the real ones live in a separate
  // record just before the EOCD.
  if (dirOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== EOCD64_LOCATOR_SIG) {
      throw new Error('zip64 archive without a locator record');
    }
    const eocd64 = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(eocd64) !== EOCD64_SIG) throw new Error('bad zip64 end-of-central-directory');
    count = Number(buf.readBigUInt64LE(eocd64 + 32));
    dirOffset = Number(buf.readBigUInt64LE(eocd64 + 48));
  }

  const entries = [];
  let p = dirOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIG) break;

    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    // Bit 11 promises UTF-8; without it the spec says CP437, and every name in
    // this data is ASCII, for which latin1 is identical.
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);

    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/') || size === 0) continue;

    entries.push({
      name,
      size,
      read() {
        if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
          throw new Error(`bad local header for ${name}`);
        }
        // The local header's own name/extra lengths can differ from the central
        // directory's, so read the data offset from the local header itself.
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        const raw = buf.subarray(start, start + compressedSize);
        if (method === 0) return raw;                 // stored
        if (method === 8) return inflateRawSync(raw); // deflate
        throw new Error(`unsupported compression method ${method} for ${name}`);
      }
    });
  }
  return entries;
}

export const looksZip = (buf) =>
  buf.length > 4 && buf.readUInt32LE(0) === LOCAL_SIG;
