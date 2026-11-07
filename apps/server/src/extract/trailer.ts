import fs from "node:fs";
import { fileTypeFromBuffer } from "file-type";
import type { TrailerInfo } from "../types.js";

/** End of the main JPEG image: walk segments to SOS, then scan entropy data for EOI. */
function jpegEnd(b: Buffer): number | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9) return i + 2;
    if (marker >= 0xd0 && marker <= 0xd7) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (marker === 0xda) {
      // Entropy-coded data until a marker that isn't stuffing (FF00) or a restart (FFD0–D7).
      let j = i + 2 + len;
      while (j + 1 < b.length) {
        if (b[j] === 0xff) {
          const n = b[j + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) { j += n === 0xff ? 1 : 2; continue; }
          if (n === 0xd9) return j + 2;
          // Progressive JPEGs: another segment (e.g. DHT/SOS) follows; resume segment walk.
          i = j;
          break;
        }
        j++;
      }
      if (j + 1 >= b.length) return undefined;
      continue;
    }
    i += 2 + len;
  }
  return undefined;
}

function pngEnd(b: Buffer): number | undefined {
  if (b.readUInt32BE(0) !== 0x89504e47) return undefined;
  let i = 8;
  while (i + 12 <= b.length) {
    const len = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    i += 12 + len;
    if (type === "IEND") return i;
  }
  return undefined;
}

function pdfEnd(b: Buffer): number | undefined {
  const s = b.toString("latin1");
  const k = s.lastIndexOf("%%EOF");
  if (k < 0) return undefined;
  let e = k + 5;
  while (e < b.length && (b[e] === 0x0d || b[e] === 0x0a || b[e] === 0x20)) e++;
  return e;
}

/** ZIP (and OOXML/ODF/JAR/APK): end of central directory record + its comment. */
function zipBounds(b: Buffer): { end: number; start: number } | undefined {
  const min = Math.max(0, b.length - 65557);
  for (let i = b.length - 22; i >= min; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      const cdSize = b.readUInt32LE(i + 12);
      const cdOffset = b.readUInt32LE(i + 16);
      const commentLen = b.readUInt16LE(i + 20);
      // Data prepended before the archive shifts every offset (self-extractors, polyglots).
      const start = Math.max(0, i - cdSize - cdOffset);
      return { end: i + 22 + commentLen, start };
    }
  }
  return undefined;
}

/** ISO BMFF (MP4/MOV/HEIC/M4A): walk top-level boxes. */
function bmffEnd(b: Buffer): number | undefined {
  if (b.toString("latin1", 4, 8) !== "ftyp") return undefined;
  let i = 0;
  while (i + 8 <= b.length) {
    let size = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) return i; // not a box: trailing garbage starts here
    if (size === 1) size = Number(b.readBigUInt64BE(i + 8));
    if (size === 0) return b.length; // box extends to EOF
    if (size < 8) return i;
    i += size;
  }
  return Math.min(i, b.length);
}

const MAX_SCAN = 512 * 1024 * 1024;

/** Finds bytes appended after the format's logical end (hidden payloads, concatenated files). */
export async function analyzeTrailer(filePath: string): Promise<TrailerInfo | undefined> {
  const size = fs.statSync(filePath).size;
  if (size === 0 || size > MAX_SCAN) return undefined;
  const b = fs.readFileSync(filePath);

  let format: string | undefined;
  let end: number | undefined;
  let leading: number | undefined;
  if ((end = jpegEnd(b)) !== undefined) format = "JPEG";
  else if ((end = pngEnd(b)) !== undefined) format = "PNG";
  else if (b.subarray(0, 1024).includes("%PDF-") && (end = pdfEnd(b)) !== undefined) format = "PDF";
  else if ((end = bmffEnd(b)) !== undefined) format = "ISO BMFF";
  else {
    const z = zipBounds(b);
    if (z) {
      format = "ZIP";
      end = z.end;
      leading = z.start || undefined;
    }
  }
  if (format === undefined || end === undefined) return undefined;

  const trailingBytes = Math.max(0, size - end);
  const info: TrailerInfo = { format, dataEnd: end, size, trailingBytes, leadingBytes: leading };
  if (trailingBytes > 0) {
    const tail = b.subarray(end, Math.min(size, end + 4100));
    info.sampleHex = tail.subarray(0, 64).toString("hex");
    const t = await fileTypeFromBuffer(tail).catch(() => undefined);
    // An appended ZIP is the classic "image that is also an archive".
    if (t) info.trailingType = `${t.mime} (.${t.ext})`;
    else if (tail.indexOf(Buffer.from("PK\x03\x04", "latin1")) >= 0) info.trailingType = "application/zip (.zip)";
  }
  return info;
}

/** Raw bytes for the hex viewer. */
export function readBytes(filePath: string, offset: number, length: number) {
  const size = fs.statSync(filePath).size;
  const start = Math.max(0, Math.min(offset, size));
  const len = Math.max(0, Math.min(length, size - start, 64 * 1024));
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buf, 0, len, start);
  } finally {
    fs.closeSync(fd);
  }
  return { offset: start, length: len, size, base64: buf.toString("base64") };
}
