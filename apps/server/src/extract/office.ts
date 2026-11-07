import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { et } from "./exiftool.js";
import type { EmbeddedMeta, OfficeComment, OfficeInfo, OfficeRevision } from "../types.js";

/** Zip-bomb guards. */
const MAX_PARTS = 5000;
const MAX_PART_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_EMBEDDED_SCANNED = 25;
const MAX_ITEMS = 500;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // Never expand DTD entities from the document.
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  trimValues: false,
});

type Node = Record<string, unknown>;

const dec = new TextDecoder("utf-8", { fatal: false });
const xml = (bytes?: Uint8Array): Node | undefined => {
  if (!bytes) return undefined;
  try {
    return parser.parse(dec.decode(bytes)) as Node;
  } catch {
    return undefined;
  }
};

/** Depth-first walk collecting every element with the given (namespace-stripped) name. */
function findAll(node: unknown, name: string, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, name, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Node)) {
      if (k === name) {
        if (Array.isArray(v)) for (const x of v) out.push((x && typeof x === "object" ? x : { "#text": x }) as Node);
        else out.push((v && typeof v === "object" ? v : { "#text": v }) as Node);
      }
      if (k[0] !== "@") findAll(v, name, out);
    }
  }
  return out;
}

/** Concatenated text of all <t>/<delText>/<p> leaves under a node. */
function textOf(node: unknown, names = ["t", "delText", "instrText"]): string {
  const parts: string[] = [];
  const walk = (n: unknown) => {
    if (typeof n === "string") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      for (const [k, v] of Object.entries(n as Node)) {
        if (k[0] === "@") continue;
        if (names.includes(k)) {
          for (const x of Array.isArray(v) ? v : [v]) {
            if (typeof x === "string") parts.push(x);
            else if (x && typeof x === "object" && typeof (x as Node)["#text"] === "string") parts.push(String((x as Node)["#text"]));
          }
        } else walk(v);
      }
    }
  };
  walk(node);
  return parts.join("").replace(/\s+/g, " ").trim();
}

const attr = (n: Node, a: string) => (n[`@${a}`] != null ? String(n[`@${a}`]) : undefined);
const clip = (s: string, n = 500) => (s.length > n ? `${s.slice(0, n)}…` : s);

function unzipGuarded(buf: Uint8Array) {
  let total = 0;
  let count = 0;
  let truncated = false;
  const files = unzipSync(buf, {
    filter: (f) => {
      count++;
      if (count > MAX_PARTS) {
        truncated = true;
        return false;
      }
      if (f.originalSize > MAX_PART_BYTES || total + f.originalSize > MAX_TOTAL_BYTES) {
        truncated = true;
        return false;
      }
      total += f.originalSize;
      return true;
    },
  });
  return { files, truncated, count };
}

export function looksLikeZip(buf: Buffer) {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7);
}

/** Pulls reviewer names, comments, tracked changes, hidden parts and external links out of OOXML/ODF. */
export async function analyzeOffice(filePath: string): Promise<OfficeInfo | undefined> {
  const buf = fs.readFileSync(filePath);
  if (!looksLikeZip(buf)) return undefined;
  const { files, truncated, count } = unzipGuarded(buf);
  const names = Object.keys(files);

  const kind: OfficeInfo["kind"] = names.includes("word/document.xml")
    ? "docx"
    : names.includes("xl/workbook.xml")
      ? "xlsx"
      : names.includes("ppt/presentation.xml")
        ? "pptx"
        : names.includes("content.xml") && names.includes("meta.xml")
          ? "odf"
          : "zip";
  if (kind === "zip") return undefined;

  const info: OfficeInfo = {
    kind,
    people: [],
    comments: [],
    revisions: [],
    hiddenSheets: [],
    notes: [],
    externalTargets: [],
    // VBA project (OOXML) or StarBasic library (ODF).
    macros: names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n) || /^Basic\/.+\.xml$/i.test(n)),
    embedded: [],
    parts: count,
    truncated: truncated || undefined,
  };
  const people = new Set<string>();
  const addPerson = (p?: string) => p && p.trim() && people.add(p.trim());

  // Macro-enabled content types (docm/xlsm/pptm) even without a visible vbaProject name.
  const ct = files["[Content_Types].xml"] ? dec.decode(files["[Content_Types].xml"]) : "";
  if (/macroEnabled|vbaProject/i.test(ct)) info.macros = true;

  // External relationships: attached templates (often local paths), linked images, OLE links, hyperlinks.
  for (const n of names.filter((x) => x.endsWith(".rels"))) {
    for (const r of findAll(xml(files[n]), "Relationship")) {
      if (attr(r, "TargetMode") !== "External") continue;
      const type = (attr(r, "Type") ?? "").split("/").pop() ?? "link";
      const target = attr(r, "Target") ?? "";
      if (info.externalTargets.length < MAX_ITEMS) info.externalTargets.push({ type, target: clip(target, 400) });
    }
  }

  if (kind === "docx") {
    for (const c of findAll(xml(files["word/comments.xml"]), "comment").slice(0, MAX_ITEMS)) {
      addPerson(attr(c, "author"));
      info.comments.push({ author: attr(c, "author"), date: attr(c, "date"), text: clip(textOf(c)) });
    }
    for (const p of findAll(xml(files["word/people.xml"]), "person")) addPerson(attr(p, "author"));
    const parts = names.filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
    for (const part of parts) {
      const doc = xml(files[part]);
      for (const [tag, type] of [["ins", "insert"], ["del", "delete"], ["rPrChange", "change"], ["pPrChange", "change"]] as const) {
        for (const r of findAll(doc, tag)) {
          if (info.revisions.length >= MAX_ITEMS) break;
          addPerson(attr(r, "author"));
          const text = type === "delete" ? textOf(r, ["delText"]) : type === "insert" ? textOf(r) : "(форматування)";
          info.revisions.push({ type, author: attr(r, "author"), date: attr(r, "date"), text: clip(text || "(порожньо)", 300) });
        }
      }
    }
  }

  if (kind === "xlsx") {
    for (const s of findAll(xml(files["xl/workbook.xml"]), "sheet")) {
      const state = attr(s, "state");
      if (state === "hidden" || state === "veryHidden") info.hiddenSheets.push(`${attr(s, "name")}${state === "veryHidden" ? " (veryHidden)" : ""}`);
    }
    for (const n of names.filter((x) => /^xl\/comments\d*\.xml$/.test(x))) {
      const doc = xml(files[n]);
      const authors = findAll(doc, "author").map((a) => textOf({ t: a["#text"] ?? "" }));
      authors.forEach(addPerson);
      for (const c of findAll(doc, "comment").slice(0, MAX_ITEMS)) {
        const idx = Number(attr(c, "authorId") ?? -1);
        info.comments.push({ author: authors[idx], text: clip(textOf(c)), where: attr(c, "ref") });
      }
    }
    for (const p of findAll(xml(files["xl/persons/person.xml"]), "person")) addPerson(attr(p, "displayName"));
    for (const n of names.filter((x) => /^xl\/threadedComments\/.*\.xml$/.test(x))) {
      for (const c of findAll(xml(files[n]), "threadedComment").slice(0, MAX_ITEMS)) {
        info.comments.push({ date: attr(c, "dT"), text: clip(textOf(c, ["text"])), where: attr(c, "ref") });
      }
    }
  }

  if (kind === "pptx") {
    for (const a of findAll(xml(files["ppt/commentAuthors.xml"]), "cmAuthor")) addPerson(attr(a, "name"));
    for (const a of findAll(xml(files["ppt/authors.xml"]), "author")) addPerson(attr(a, "name"));
    for (const n of names.filter((x) => /^ppt\/comments\/.*\.xml$/.test(x))) {
      for (const c of [...findAll(xml(files[n]), "cm")].slice(0, MAX_ITEMS)) {
        info.comments.push({ date: attr(c, "dt") ?? attr(c, "created"), text: clip(textOf(c, ["text", "t"])), where: path.basename(n, ".xml") });
      }
    }
    for (const n of names.filter((x) => /^ppt\/notesSlides\/.*\.xml$/.test(x)).sort()) {
      const t = textOf(xml(files[n]));
      // Notes always contain the slide number placeholder; keep only real text.
      if (t.replace(/\d+/g, "").trim().length > 2 && info.notes.length < 100) info.notes.push(clip(t, 400));
    }
  }

  if (kind === "odf") {
    const content = xml(files["content.xml"]);
    for (const ch of findAll(content, "changed-region").slice(0, MAX_ITEMS)) {
      const creator = textOf(ch, ["creator"]);
      const date = textOf(ch, ["date"]);
      addPerson(creator);
      const type = findAll(ch, "deletion").length ? "delete" : findAll(ch, "insertion").length ? "insert" : "change";
      info.revisions.push({ type, author: creator || undefined, date: date || undefined, text: clip(textOf(ch, ["p", "span"]) || "(див. документ)", 300) });
    }
    for (const a of findAll(content, "annotation").slice(0, MAX_ITEMS)) {
      const creator = textOf(a, ["creator"]);
      addPerson(creator);
      info.comments.push({ author: creator || undefined, date: textOf(a, ["date"]) || undefined, text: clip(textOf(a, ["p", "span"])) });
    }
  }

  info.people = [...people].slice(0, MAX_ITEMS);

  // Embedded media keep their own EXIF (GPS, camera, author) — a classic leak.
  const media = names.filter((n) => /^(word|xl|ppt)\/(media|embeddings)\/|^Pictures\//.test(n));
  const tmpDir = media.length ? fs.mkdtempSync(path.join(os.tmpdir(), "mc-office-")) : null;
  try {
    for (const [i, n] of media.entries()) {
      const bytes = files[n];
      const entry: EmbeddedMeta = { name: n, size: bytes.length };
      if (i < MAX_EMBEDDED_SCANNED && tmpDir && /\.(jpe?g|png|tiff?|heic|webp|gif)$/i.test(n)) {
        const tmp = path.join(tmpDir, `e${i}${path.extname(n).toLowerCase()}`);
        fs.writeFileSync(tmp, bytes);
        try {
          const t = (await et.readRaw(tmp, { readArgs: ["-n", "-fast"], ignoreMinorErrors: true })) as Record<string, unknown>;
          const lat = Number(t.GPSLatitude), lon = Number(t.GPSLongitude);
          if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) entry.gps = { lat, lon };
          const make = t.Make ? String(t.Make) : "";
          const model = t.Model ? String(t.Model) : "";
          const dev = model.startsWith(make) ? model : [make, model].filter(Boolean).join(" ");
          if (dev) entry.device = dev;
          if (t.Software) entry.software = String(t.Software);
          if (t.DateTimeOriginal ?? t.CreateDate) entry.created = String(t.DateTimeOriginal ?? t.CreateDate);
          if (t.Artist ?? t.Creator) entry.author = String(t.Artist ?? t.Creator);
        } catch {
          /* unreadable embedded image: keep name/size only */
        }
      }
      if (info.embedded.length < MAX_ITEMS) info.embedded.push(entry);
    }
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return info;
}
