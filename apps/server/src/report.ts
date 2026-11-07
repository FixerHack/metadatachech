import path from "node:path";
import type { Anomaly, DeepReport, MetaEntry, Report } from "./types.js";

function find(entries: MetaEntry[], tags: string[], groups?: string[]): MetaEntry | undefined {
  for (const t of tags) {
    const e = entries.find((x) => x.tag === t && (!groups || groups.includes(x.group)));
    if (e && e.value !== "" && e.value != null) return e;
  }
  return undefined;
}

const str = (e?: MetaEntry) => (e ? String(e.value) : undefined);
const num = (e?: MetaEntry) => {
  if (!e) return undefined;
  const v = Number(e.raw ?? e.value);
  return Number.isFinite(v) ? v : undefined;
};

const EDITORS = /photoshop|lightroom|gimp|affinity|pixelmator|snapseed|picsart|canva|paint\.net|capture one|darktable|luminar|facetune|remini|midjourney|dall.?e|stable diffusion|firefly|imagen/i;
const AI_MARKERS = /trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia|midjourney|dall.?e|stable diffusion|firefly|generative|ai generated/i;

/** ExifTool dates look like "2024:05:01 12:00:00+02:00". */
function parseExifDate(v?: string): number | undefined {
  if (!v) return undefined;
  const m = v.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export function buildReport(
  entries: MetaEntry[],
  ctx: { originalName: string; detectedExt?: string; detectedMime?: string; warnings: string[]; deep?: DeepReport },
): Report {
  const groups: Record<string, number> = {};
  let high = 0, medium = 0, low = 0;
  for (const e of entries) {
    groups[e.group] = (groups[e.group] ?? 0) + 1;
    if (e.risk === "high") high++;
    else if (e.risk === "medium") medium++;
    else low++;
  }

  const report: Report = {
    counts: { total: entries.length, high, medium, low, groups },
    anomalies: [],
    warnings: ctx.warnings,
  };

  const lat = num(find(entries, ["GPSLatitude"], ["Composite"]) ?? find(entries, ["GPSLatitude"]));
  const lon = num(find(entries, ["GPSLongitude"], ["Composite"]) ?? find(entries, ["GPSLongitude"]));
  if (lat !== undefined && lon !== undefined && !(lat === 0 && lon === 0)) {
    report.gps = { lat, lon, alt: num(find(entries, ["GPSAltitude"])) };
  }

  const make = str(find(entries, ["Make", "DeviceManufacturer"]));
  const model = str(find(entries, ["Model", "CameraModelName", "DeviceModel"]));
  if (make || model) report.device = [make, model && make && model.startsWith(make) ? model.slice(make.length).trim() : model].filter(Boolean).join(" ");
  report.lens = str(find(entries, ["LensID", "LensModel", "Lens"]));
  const softwareEntry = find(entries, ["Software", "CreatorTool", "Producer", "Application", "Encoder", "WritingApp"]);
  report.software = str(softwareEntry);
  report.author = str(find(entries, ["Artist", "Author", "Creator", "By-line", "OwnerName", "CameraOwnerName", "LastModifiedBy"]));
  const created = find(entries, ["DateTimeOriginal", "CreateDate", "CreationDate", "DateCreated", "MediaCreateDate"]);
  const modified = find(entries, ["ModifyDate", "MetadataDate"]);
  report.created = str(created);
  report.modified = str(modified);
  report.dimensions = str(find(entries, ["ImageSize"], ["Composite"]));
  report.duration = str(find(entries, ["Duration"]));

  const a = report.anomalies;
  const push = (x: Anomaly) => a.push(x);

  // 1. Extension vs real content
  const ext = path.extname(ctx.originalName).slice(1).toLowerCase();
  const normalize = (x: string) => ({ jpeg: "jpg", tiff: "tif", htm: "html" } as Record<string, string>)[x] ?? x;
  if (ext && ctx.detectedExt && normalize(ext) !== normalize(ctx.detectedExt)) {
    push({
      level: "warning",
      code: "ext_mismatch",
      message: `Розширення .${ext} не відповідає вмісту: насправді це ${ctx.detectedMime ?? ctx.detectedExt} (.${ctx.detectedExt}).`,
    });
  }

  // 2. Editing software
  const allSoftware = entries
    .filter((e) => /^(Software|CreatorTool|HistorySoftwareAgent|Producer|Application)$/i.test(e.tag))
    .map((e) => String(e.value));
  const editor = allSoftware.find((s) => EDITORS.test(s));
  if (editor) push({ level: "warning", code: "edited", message: `Файл оброблено в редакторі: ${editor}.` });

  // 3. AI / C2PA markers
  const ai = entries.find((e) => typeof e.value === "string" && AI_MARKERS.test(e.value));
  if (ai) push({ level: "warning", code: "ai_marker", message: `Ознака згенерованого ШІ контенту в ${ai.group}:${ai.tag} = ${String(ai.value).slice(0, 120)}.` });
  if (entries.some((e) => e.group === "JUMBF" || /c2pa/i.test(e.subgroup))) {
    push({ level: "info", code: "c2pa", message: "Файл містить Content Credentials (C2PA / JUMBF)." });
  }

  // 4. Dates disagree
  const tc = parseExifDate(str(created));
  const tm = parseExifDate(str(modified));
  if (tc && tm && tm - tc > 60_000) {
    push({ level: "info", code: "modified_after", message: `Файл змінювали після створення: ${str(created)} → ${str(modified)}.` });
  }
  if (tc && tc > Date.now() + 86_400_000) push({ level: "warning", code: "future_date", message: `Дата створення в майбутньому: ${str(created)}.` });

  // 5. XMP edit history
  const history = entries.filter((e) => /^History(Action|When|SoftwareAgent)$/.test(e.tag));
  if (history.length) push({ level: "info", code: "xmp_history", message: `Збережена історія редагувань XMP (${history.length} записів).` });

  // 6. Embedded previews
  const previews = entries.filter((e) => /^(ThumbnailImage|PreviewImage|JpgFromRaw|OtherImage)$/.test(e.tag));
  if (previews.length) push({ level: "info", code: "embedded_preview", message: `Вбудовані превʼю: ${previews.map((p) => p.tag).join(", ")}. Вони можуть показувати оригінал до обрізання чи ретуші.` });

  // 7. Trailing data / ExifTool warnings
  for (const w of ctx.warnings) {
    if (/trailer|after end|unknown trailer/i.test(w)) push({ level: "warning", code: "trailer", message: `Дані після кінця файлу: ${w}` });
  }

  // 8. Stripped metadata
  const meaningful = entries.filter((e) => !["File", "System", "ExifTool", "Composite", "Structure"].includes(e.group));
  if (meaningful.length === 0) push({ level: "info", code: "stripped", message: "Метаданих майже немає: файл, імовірно, очищено або пересохранено (месенджер, соцмережа)." });

  if (ctx.deep) deepAnomalies(ctx.deep, push);

  return report;
}

const n = (x: number, one: string, few: string, many: string) => {
  const m10 = x % 10, m100 = x % 100;
  const w = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${x} ${w}`;
};

function deepAnomalies(d: DeepReport, push: (a: Anomaly) => void) {
  const t = d.trailer;
  if (t?.trailingBytes) {
    push({
      level: "warning",
      code: "trailing_data",
      message: `Після кінця ${t.format} є ще ${n(t.trailingBytes, "байт", "байти", "байтів")} (з позиції ${t.dataEnd})${t.trailingType ? `, схоже на ${t.trailingType}` : ""}. Так ховають вкладені файли або сліди редагування — подивись у hex-переглядачі.`,
    });
  }
  if (t?.leadingBytes) {
    push({ level: "warning", code: "leading_data", message: `Перед ZIP-архівом є ${n(t.leadingBytes, "байт", "байти", "байтів")} сторонніх даних (поліглот або самовідкривний архів).` });
  }

  for (const p of d.previews ?? []) {
    if (p.differs) {
      push({ level: "warning", code: "preview_differs", message: `Вбудоване превʼю ${p.tag} показує інше зображення, ніж основне (відмінність ${p.distance}/64). Основне, ймовірно, відредаговане — превʼю може містити оригінал.` });
    } else if (p.cropped) {
      push({ level: "warning", code: "preview_cropped", message: `Пропорції превʼю ${p.tag} (${p.aspectPreview}) не збігаються з основним зображенням (${p.aspectMain}) — фото, ймовірно, обрізали, а превʼю лишилося від оригіналу.` });
    }
  }

  const o = d.office;
  if (o) {
    if (o.macros) push({ level: "warning", code: "office_macros", message: "Документ містить макроси (VBA/Basic) — виконуваний код. Не відкривай з увімкненими макросами." });
    if (o.revisions.length) {
      const authors = [...new Set(o.revisions.map((r) => r.author).filter(Boolean))];
      push({ level: "warning", code: "office_revisions", message: `${n(o.revisions.length, "незастосоване виправлення", "незастосовані виправлення", "незастосованих виправлень")} у режимі рецензування${authors.length ? ` (${authors.slice(0, 5).join(", ")})` : ""}. Видалений текст досі лежить у файлі.` });
    }
    if (o.comments.length) push({ level: "warning", code: "office_comments", message: `${n(o.comments.length, "коментар", "коментарі", "коментарів")} рецензентів усередині документа.` });
    if (o.hiddenSheets.length) push({ level: "warning", code: "office_hidden_sheets", message: `Приховані аркуші: ${o.hiddenSheets.join(", ")}.` });
    if (o.notes.length) push({ level: "info", code: "office_notes", message: `${n(o.notes.length, "слайд має", "слайди мають", "слайдів мають")} нотатки доповідача.` });
    const local = o.externalTargets.filter((x) => /^[a-z]:\\|^file:|\\\\/i.test(x.target));
    if (local.length) push({ level: "warning", code: "office_local_paths", message: `Посилання на локальні шляхи чи мережеві ресурси: ${local.slice(0, 3).map((x) => x.target).join("; ")}.` });
    const gps = o.embedded.filter((e) => e.gps);
    if (gps.length) push({ level: "warning", code: "office_embedded_gps", message: `${n(gps.length, "вкладене зображення містить", "вкладені зображення містять", "вкладених зображень містять")} GPS-координати: ${gps.slice(0, 3).map((e) => e.name.split("/").pop()).join(", ")}.` });
    if (o.truncated) push({ level: "info", code: "office_truncated", message: "Архів документа завеликий — частину вмісту пропущено (захист від ZIP-бомб)." });
  }

  const p = d.pdf;
  if (p) {
    const f = p.features;
    const active = ["JavaScript", "JS", "OpenAction", "AA", "Launch", "RichMedia", "XFA", "SubmitForm", "ImportData"].filter((k) => f[k]);
    if (active.length) push({ level: "warning", code: "pdf_active", message: `PDF містить активний вміст: ${active.map((k) => `/${k}×${f[k]}`).join(", ")}. Відкривай в ізольованому переглядачі.` });
    if (f.EmbeddedFile) push({ level: "warning", code: "pdf_embedded", message: `Вкладені файли в PDF: ${p.embeddedFiles.length ? p.embeddedFiles.slice(0, 5).join(", ") : n(f.EmbeddedFile, "обʼєкт", "обʼєкти", "обʼєктів")}.` });
    if (p.incrementalUpdates) push({ level: "warning", code: "pdf_incremental", message: `PDF змінювали ${n(p.incrementalUpdates, "раз", "рази", "разів")} інкрементно — попередні версії тексту й метаданих можна відновити.` });
    if (p.obfuscatedNames) push({ level: "warning", code: "pdf_obfuscated", message: `${n(p.obfuscatedNames, "замасковане імʼя", "замасковані імена", "замаскованих імен")} обʼєктів (#-кодування) — типовий прийом, щоб обійти антивірус.` });
    if (f.Encrypt) push({ level: "info", code: "pdf_encrypted", message: "PDF зашифрований: частина вмісту може бути недоступна для аналізу." });
    if (p.uris.length) push({ level: "info", code: "pdf_links", message: `${n(p.uris.length, "зовнішнє посилання", "зовнішні посилання", "зовнішніх посилань")} у документі.` });
  }

  const m = d.media;
  if (m) {
    const loc = Object.entries(m.tags).find(([k]) => /location|ISO6709/i.test(k));
    if (loc) push({ level: "warning", code: "media_location", message: `Відео/аудіо містить геолокацію: ${loc[1]}.` });
    const enc = m.tags.encoder ?? m.streams.map((s) => s.tags.encoder).find(Boolean);
    if (enc && /lavf|handbrake|ffmpeg|premiere|davinci|capcut|final cut/i.test(enc)) push({ level: "info", code: "media_reencoded", message: `Файл перекодовано або змонтовано: ${enc}.` });
  }

  for (const e of d.errors) push({ level: "info", code: "deep_error", message: `Не вдалося виконати частину аналізу — ${e}` });
}
