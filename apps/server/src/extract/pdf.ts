import fs from "node:fs";
import zlib from "node:zlib";
import type { PdfInfo } from "../types.js";

/** Keywords that indicate active or hidden content (same set as Didier Stevens' pdfid). */
const KEYWORDS = [
  "JS", "JavaScript", "AA", "OpenAction", "AcroForm", "XFA", "Launch", "EmbeddedFile", "RichMedia",
  "JBIG2Decode", "Encrypt", "ObjStm", "URI", "SubmitForm", "GoToR", "GoToE", "ImportData",
];

const MAX_READ = 200 * 1024 * 1024;
const MAX_STREAM_OUT = 8 * 1024 * 1024;
const MAX_TOTAL_INFLATE = 64 * 1024 * 1024;
const MAX_STREAMS = 5000;

/** "/J#61vaScript" → "/JavaScript"; returns decoded text and how many names were hex-escaped. */
function normalizeNames(s: string): { text: string; obfuscated: number } {
  let obfuscated = 0;
  const text = s.replace(/\/([A-Za-z0-9#]*#[0-9A-Fa-f]{2}[A-Za-z0-9#]*)/g, (_m, name: string) => {
    obfuscated++;
    return "/" + name.replace(/#([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
  });
  return { text, obfuscated };
}

function countKeywords(text: string, into: Record<string, number>) {
  for (const k of KEYWORDS) {
    const re = new RegExp(`/${k}(?![A-Za-z0-9])`, "g");
    const n = text.match(re)?.length ?? 0;
    if (n) into[k] = (into[k] ?? 0) + n;
  }
}

/** PDF literal string → JS string (handles the common escapes). */
function pdfString(s: string) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, e: string) => {
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    return map[e] ?? String.fromCharCode(parseInt(e, 8));
  });
}

export function isPdf(buf: Buffer) {
  return buf.subarray(0, 1024).includes("%PDF-");
}

/**
 * Raw scan for active content, embedded files, links and edit history.
 * Flate-compressed streams (including object streams) are inflated with size caps so keywords
 * hidden inside them are counted too.
 */
export function analyzePdf(filePath: string): PdfInfo | undefined {
  const fd = fs.openSync(filePath, "r");
  let buf: Buffer;
  try {
    const size = fs.fstatSync(fd).size;
    buf = Buffer.alloc(Math.min(size, MAX_READ));
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!isPdf(buf)) return undefined;

  const raw = buf.toString("latin1");
  const features: Record<string, number> = {};
  const { text: top, obfuscated: obfTop } = normalizeNames(raw);
  countKeywords(top, features);
  let obfuscatedNames = obfTop;

  // Inflate Flate streams and scan their contents as well.
  const chunks: string[] = [];
  let streamsScanned = 0;
  let streamsSkipped = 0;
  let inflatedTotal = 0;
  const streamRe = /\/FlateDecode[\s\S]{0,400}?stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(raw)) && streamsScanned + streamsSkipped < MAX_STREAMS) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    streamRe.lastIndex = end;
    if (inflatedTotal >= MAX_TOTAL_INFLATE) {
      streamsSkipped++;
      continue;
    }
    try {
      const out = zlib.inflateSync(buf.subarray(start, end), { maxOutputLength: MAX_STREAM_OUT, finishFlush: zlib.constants.Z_SYNC_FLUSH });
      inflatedTotal += out.length;
      const s = out.toString("latin1");
      // Skip image/font payloads quickly: only keep streams that look like PDF syntax.
      if (/\/[A-Za-z]{2,}/.test(s.slice(0, 4096))) {
        const n = normalizeNames(s);
        obfuscatedNames += n.obfuscated;
        chunks.push(n.text);
      }
      streamsScanned++;
    } catch {
      streamsSkipped++;
    }
  }
  const inner = chunks.join("\n");
  countKeywords(inner, features);

  const all = `${top}\n${inner}`;
  const uris = new Set<string>();
  for (const u of all.matchAll(/\/URI\s*\(((?:\\.|[^\\)]){1,1000})\)/g)) {
    if (uris.size >= 100) break;
    uris.add(pdfString(u[1]).slice(0, 400));
  }
  const embeddedFiles = new Set<string>();
  if (features.EmbeddedFile) {
    for (const f of all.matchAll(/\/Type\s*\/Filespec[\s\S]{0,600}?\/(?:UF|F)\s*\(((?:\\.|[^\\)]){1,300})\)/g)) {
      if (embeddedFiles.size >= 100) break;
      embeddedFiles.add(pdfString(f[1]));
    }
  }

  const eofMarkers = raw.match(/%%EOF/g)?.length ?? 0;
  const startxrefs = raw.match(/startxref/g)?.length ?? 0;
  // Linearized ("fast web view") files have 2 xref sections without being edited.
  const linearized = /\/Linearized\s/.test(raw.slice(0, 2048));
  return {
    version: raw.match(/%PDF-(\d\.\d)/)?.[1],
    eofMarkers,
    incrementalUpdates: Math.max(0, Math.max(eofMarkers, startxrefs) - 1 - (linearized ? 1 : 0)),
    features,
    obfuscatedNames,
    uris: [...uris],
    embeddedFiles: [...embeddedFiles],
    streamsScanned,
    streamsSkipped,
  };
}
