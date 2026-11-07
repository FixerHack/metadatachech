import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { et } from "../extract/exiftool.js";
import { canWriteFileType } from "../extract/capabilities.js";
import { addVersion, analyzePath, getEntries, getFile, getFileRow, getVersion, versionPath, type FileRow } from "../files.js";
import { diffEntries, type DiffItem } from "./diff.js";
import { EditError, PRESETS, planPasses, type EditOp } from "./ops.js";

/** One edit at a time per file, so version numbers never race. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(id, next);
  const release = () => {
    if (locks.get(id) === next) locks.delete(id);
  };
  // Separate handler chain: the caller still sees the rejection, nothing is left unhandled.
  next.then(release, release);
  return next;
}

class NotFound extends EditError {
  statusCode = 404;
}

function describe(ops: EditOp[]): string {
  const parts = ops.map((op) => {
    switch (op.kind) {
      case "set": return `${op.tag} = ${String(op.value).slice(0, 40)}`;
      case "delete": return `− ${op.tag}`;
      case "preset": return PRESETS[op.preset].label;
      case "shiftDates": return `Зсув дат ${op.by}`;
      case "setGps": return `GPS ${op.lat.toFixed(5)}, ${op.lon.toFixed(5)}`;
    }
  });
  const text = parts.slice(0, 3).join("; ");
  return parts.length > 3 ? `${text} і ще ${parts.length - 3}` : text;
}

/**
 * Presets list tags for every format; ExifTool warns about ones that don't
 * apply to this file. Those are expected and not worth showing.
 */
const PRESET_NOISE = /is not defined|is not writable|No writable tags set from|doesn't exist or isn't writable/i;

interface WriteOutcome {
  warnings: string[];
  changed: boolean;
}

async function writeOps(target: string, ops: EditOp[]): Promise<WriteOutcome> {
  const warnings: string[] = [];
  let changed = false;
  for (const pass of planPasses(ops)) {
    const res = await et
      .write(target, pass.tags, {
        writeArgs: ["-overwrite_original", ...pass.args],
        ignoreMinorErrors: true,
      })
      .catch((err: Error) => {
        // ExifTool refusals (bad value, corrupt file) are the user's to see, not a server fault.
        throw new EditError(`ExifTool не зміг записати: ${err.message.replace(/ - \S*work\.\w+$/, "")}`);
      });
    if (res.updated > 0 || res.created > 0) changed = true;
    const w = (res as { warnings?: string[] }).warnings;
    if (w) warnings.push(...w.filter((x) => !PRESET_NOISE.test(x)));
  }
  return { warnings: [...new Set(warnings)], changed };
}

function extraWarnings(file: FileRow, ops: EditOp[]): string[] {
  const out: string[] = [];
  const isPdf = file.detected_ext === "pdf";
  if (isPdf) {
    out.push(
      "PDF: ExifTool дописує зміни інкрементально, тому старі значення фізично лишаються у файлі й можуть бути відновлені. Для повного очищення файл треба перезібрати (буде на етапі 7).",
    );
  }
  if (ops.some((o) => o.kind === "preset" && (o.preset === "all" || o.preset === "keepCopyright"))) {
    out.push("Деякі дані (структура файлу, частина MakerNotes, дані поза метаданими) прибрати не можна — вони потрібні для відкриття файлу.");
  }
  return out;
}

async function prepare(fileId: string) {
  const file = getFileRow(fileId);
  const version = getVersion(fileId);
  if (!file || !version) throw new NotFound("Файл не знайдено");
  const src = versionPath(version);
  const typeExt = getEntries(version.id).find((e) => e.group === "File" && e.tag === "FileTypeExtension")?.raw ?? file.detected_ext;
  if (!(await canWriteFileType(String(typeExt ?? "")))) {
    throw new EditError(`ExifTool не вміє записувати формат ${String(typeExt ?? "невідомий").toUpperCase()} — доступний лише перегляд.`);
  }
  // ExifTool picks the writer by extension, so a JPEG uploaded as ".png" must be worked on as ".jpg".
  const realExt = `.${String(typeExt).toLowerCase()}`;
  return { file, version, src, realExt };
}

function tmpCopy(src: string, ext = path.extname(src)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-edit-"));
  const tmp = path.join(dir, `work${ext}`);
  fs.copyFileSync(src, tmp);
  return { tmp, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export interface PreviewResult {
  diff: DiffItem[];
  warnings: string[];
  changed: boolean;
}

/** Applies ops to a throwaway copy and reports exactly what would change. */
export async function previewEdit(fileId: string, ops: EditOp[]): Promise<PreviewResult> {
  const { file, version, src, realExt } = await prepare(fileId);
  const { tmp, cleanup } = tmpCopy(src, realExt);
  try {
    const out = await writeOps(tmp, ops);
    const { entries } = await analyzePath(tmp, file);
    const diff = diffEntries(getEntries(version.id), entries);
    return { diff, warnings: [...out.warnings, ...extraWarnings(file, ops)], changed: out.changed && diff.length > 0 };
  } finally {
    cleanup();
  }
}

/** Applies ops and stores the result as a new version. */
export function applyEdit(fileId: string, ops: EditOp[], note?: string, userId?: string) {
  return withLock(fileId, async () => {
    const { file, version, src, realExt } = await prepare(fileId);
    const { tmp, cleanup } = tmpCopy(src, realExt);
    try {
      const out = await writeOps(tmp, ops);
      const { entries } = await analyzePath(tmp, file);
      const diff = diffEntries(getEntries(version.id), entries);
      if (diff.length === 0) {
        return { created: false as const, diff, warnings: [...out.warnings, "Змін немає — нову версію не створено."], detail: await getFile(fileId) };
      }
      const number = await addVersion(file, tmp, note?.trim() || describe(ops), userId);
      return { created: true as const, version: number, diff, warnings: [...out.warnings, ...extraWarnings(file, ops)], detail: await getFile(fileId) };
    } finally {
      cleanup();
    }
  });
}

/** Restores an old version by copying it as the newest one (history is never rewritten). */
export function revertTo(fileId: string, number: number, userId?: string) {
  return withLock(fileId, async () => {
    const file = getFileRow(fileId);
    const target = getVersion(fileId, number);
    const latest = getVersion(fileId);
    if (!file || !target || !latest) throw new NotFound("Версію не знайдено");
    if (target.number === latest.number) throw new EditError("Це вже поточна версія");
    const { tmp, cleanup } = tmpCopy(versionPath(target));
    try {
      const newNumber = await addVersion(file, tmp, `Відкат до v${number}`, userId);
      return { version: newNumber, detail: await getFile(fileId) };
    } finally {
      cleanup();
    }
  });
}

export async function diffVersions(fileId: string, a: number, b: number) {
  const va = getVersion(fileId, a);
  const vb = getVersion(fileId, b);
  if (!va || !vb) throw new NotFound("Версію не знайдено");
  return diffEntries(getEntries(va.id), getEntries(vb.id));
}

export async function batchEdit(ids: string[], ops: EditOp[], note?: string, userId?: string) {
  if (!Array.isArray(ids) || ids.length === 0) throw new EditError("Не вибрано жодного файлу");
  if (ids.length > 200) throw new EditError("Забагато файлів (макс. 200)");
  const results = [];
  for (const id of ids) {
    try {
      const r = await applyEdit(String(id), ops, note, userId);
      results.push({ id, ok: true, created: r.created, version: r.created ? r.version : undefined, changes: r.diff.length, warnings: r.warnings });
    } catch (err) {
      results.push({ id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

