import { isMediaType, probeMedia } from "./media.js";
import { analyzeOffice } from "./office.js";
import { analyzePdf } from "./pdf.js";
import { analyzePreviews } from "./previews.js";
import { analyzeTrailer } from "./trailer.js";
import { classify } from "../risk.js";
import type { DeepReport, MetaEntry, Risk } from "../types.js";

/** Groups produced here; none of them are writable through ExifTool. */
export const DEEP_GROUPS = ["FFprobe", "Office", "PDFScan", "Structure"];

async function safely<T>(label: string, errors: string[], fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message.split("\n")[0].slice(0, 300)}`);
    return undefined;
  }
}

export interface DeepContext {
  mime?: string | null;
  ext?: string | null;
  entries: MetaEntry[];
  /** Where extracted previews/thumbnails go; omit to skip writing files (e.g. edit previews). */
  outDir?: string;
  urlFor?: (name: string) => string;
}

export async function runDeep(filePath: string, ctx: DeepContext): Promise<DeepReport> {
  const errors: string[] = [];
  const fileType = String(ctx.entries.find((e) => e.group === "File" && e.tag === "FileType")?.value ?? "");
  const mimeFromExif = String(ctx.entries.find((e) => e.group === "File" && e.tag === "MIMEType")?.value ?? "");
  const mime = ctx.mime || mimeFromExif;

  const [media, office, pdf, trailer, pv] = await Promise.all([
    isMediaType(mime, ctx.ext) ? safely("ffprobe", errors, () => probeMedia(filePath)) : undefined,
    /zip|officedocument|opendocument|DOCX|XLSX|PPTX|ODT|ODS|ODP/i.test(`${mime} ${fileType}`) ? safely("Office", errors, () => analyzeOffice(filePath)) : undefined,
    /pdf/i.test(`${mime} ${fileType}`) ? safely("PDF", errors, () => analyzePdf(filePath)) : undefined,
    safely("Структура", errors, () => analyzeTrailer(filePath)),
    ctx.outDir && ctx.urlFor ? safely("Превʼю", errors, () => analyzePreviews(filePath, ctx.entries, ctx.outDir!, ctx.urlFor!)) : undefined,
  ]);

  return {
    media,
    office,
    pdf,
    trailer,
    previews: pv?.previews.length ? pv.previews : undefined,
    mainImage: pv?.main,
    errors,
  };
}

/** Tag names must stay usable as comment field paths. */
const safeTag = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80) || "_";

/** Flattens the deep report into table rows so search, risk and field comments work on it. */
export function deepEntries(d: DeepReport): MetaEntry[] {
  const out: MetaEntry[] = [];
  const add = (group: string, subgroup: string, tag: string, value: unknown, risk?: Risk, reason?: string) => {
    if (value === undefined || value === null || value === "") return;
    const auto = classify(tag, value, group);
    const e: MetaEntry = { group, subgroup, tag: safeTag(tag), value, risk: risk ?? auto.risk };
    const why = reason ?? auto.reason;
    if (why) e.riskReason = why;
    out.push(e);
  };

  if (d.media) {
    const m = d.media;
    add("FFprobe", "Format", "Format", m.formatLong ?? m.format);
    add("FFprobe", "Format", "Duration", m.duration ? `${Number(m.duration).toFixed(2)} с` : undefined);
    add("FFprobe", "Format", "BitRate", m.bitRate ? `${Math.round(Number(m.bitRate) / 1000)} кбіт/с` : undefined);
    add("FFprobe", "Format", "Chapters", m.chapters || undefined);
    for (const [k, v] of Object.entries(m.tags)) {
      const loc = /location|ISO6709|xyz/i.test(k);
      add("FFprobe", "Format", k, v, loc ? "high" : undefined, loc ? "Геолокація" : undefined);
    }
    for (const s of m.streams) {
      const sg = `Stream${s.index}-${s.type}`;
      add("FFprobe", sg, "Codec", s.codecLong ? `${s.codec} (${s.codecLong})` : s.codec);
      add("FFprobe", sg, "Profile", s.profile);
      add("FFprobe", sg, "Resolution", s.width && s.height ? `${s.width}×${s.height}` : undefined);
      add("FFprobe", sg, "FrameRate", s.fps);
      add("FFprobe", sg, "PixelFormat", s.pixFmt);
      add("FFprobe", sg, "SampleRate", s.sampleRate ? `${s.sampleRate} Гц` : undefined);
      add("FFprobe", sg, "Channels", s.channelLayout ?? s.channels);
      add("FFprobe", sg, "BitRate", s.bitRate ? `${Math.round(Number(s.bitRate) / 1000)} кбіт/с` : undefined);
      add("FFprobe", sg, "Duration", s.duration ? `${Number(s.duration).toFixed(2)} с` : undefined);
      for (const [k, v] of Object.entries(s.tags)) add("FFprobe", sg, k, v);
    }
  }

  if (d.office) {
    const o = d.office;
    add("Office", "Document", "Kind", o.kind.toUpperCase());
    add("Office", "Document", "Parts", o.parts);
    if (o.macros) add("Office", "Document", "Macros", "Так (VBA/Basic)", "high", "Виконуваний код");
    o.people.forEach((p, i) => add("Office", "People", `Person${i + 1}`, p, "high", "Особа (рецензент/автор)"));
    o.comments.forEach((c, i) =>
      add("Office", "Comments", `Comment${i + 1}`, `${c.author ?? "?"}${c.date ? ` · ${c.date}` : ""}${c.where ? ` · ${c.where}` : ""}: ${c.text}`, "high", "Прихований коментар"),
    );
    o.revisions.forEach((r, i) =>
      add("Office", "Revisions", `${r.type === "insert" ? "Inserted" : r.type === "delete" ? "Deleted" : "Changed"}${i + 1}`,
        `${r.author ?? "?"}${r.date ? ` · ${r.date}` : ""}: ${r.text}`, "high", "Виправлення в режимі рецензування"),
    );
    o.hiddenSheets.forEach((s, i) => add("Office", "Sheets", `HiddenSheet${i + 1}`, s, "medium", "Прихований аркуш"));
    o.notes.forEach((n, i) => add("Office", "Notes", `SpeakerNotes${i + 1}`, n, "medium", "Нотатки доповідача"));
    o.externalTargets.forEach((t, i) => add("Office", "External", `${t.type}${i + 1}`, t.target, /^[a-z]:\\|^file:|\\\\/i.test(t.target) ? "high" : "medium", /^[a-z]:\\|^file:|\\\\/i.test(t.target) ? "Локальний шлях / мережевий ресурс" : "Зовнішнє посилання"));
    o.embedded.forEach((e, i) => {
      const sg = "Embedded";
      add("Office", sg, `File${i + 1}`, `${e.name} (${e.size} Б)`);
      if (e.gps) add("Office", sg, `File${i + 1}.GPS`, `${e.gps.lat.toFixed(6)}, ${e.gps.lon.toFixed(6)}`, "high", "Геолокація у вкладеному зображенні");
      if (e.device) add("Office", sg, `File${i + 1}.Device`, e.device, "medium", "Модель пристрою");
      if (e.author) add("Office", sg, `File${i + 1}.Author`, e.author, "high", "Особа");
      if (e.software) add("Office", sg, `File${i + 1}.Software`, e.software, "medium", "Програмне забезпечення");
      if (e.created) add("Office", sg, `File${i + 1}.Created`, e.created, "medium", "Дата й час");
    });
  }

  if (d.pdf) {
    const p = d.pdf;
    add("PDFScan", "Structure", "Version", p.version);
    add("PDFScan", "Structure", "IncrementalUpdates", p.incrementalUpdates, p.incrementalUpdates ? "medium" : "low", p.incrementalUpdates ? "Попередні версії документа можна відновити" : undefined);
    add("PDFScan", "Structure", "StreamsScanned", p.streamsScanned);
    if (p.obfuscatedNames) add("PDFScan", "Structure", "ObfuscatedNames", p.obfuscatedNames, "high", "Замасковані імена обʼєктів");
    const ACTIVE = new Set(["JS", "JavaScript", "AA", "OpenAction", "Launch", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToE", "GoToR"]);
    for (const [k, n] of Object.entries(p.features)) {
      add("PDFScan", "Keywords", k, n, ACTIVE.has(k) ? "high" : k === "EmbeddedFile" ? "medium" : "low", ACTIVE.has(k) ? "Активний вміст" : k === "EmbeddedFile" ? "Вкладений файл" : undefined);
    }
    p.uris.forEach((u, i) => add("PDFScan", "Links", `URI${i + 1}`, u));
    p.embeddedFiles.forEach((f, i) => add("PDFScan", "Attachments", `File${i + 1}`, f, "medium", "Вкладений файл"));
  }

  if (d.trailer) {
    const t = d.trailer;
    add("Structure", "Container", "Format", t.format);
    add("Structure", "Container", "DataEnd", t.dataEnd);
    add("Structure", "Container", "TrailingBytes", t.trailingBytes, t.trailingBytes ? "high" : "low", t.trailingBytes ? "Дані після кінця файлу" : undefined);
    add("Structure", "Container", "TrailingType", t.trailingType, "high", "Вкладений файл у хвості");
    add("Structure", "Container", "LeadingBytes", t.leadingBytes, "high", "Дані перед архівом");
  }

  return out;
}
