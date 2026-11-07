import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileTypeFromFile } from "file-type";
import { config } from "./config.js";
import { db } from "./db.js";
import { extractExif, exiftoolVersion } from "./extract/exiftool.js";
import { canWriteFileType, isTagWritable } from "./extract/capabilities.js";
import { hashFile } from "./extract/hashes.js";
import { buildReport } from "./report.js";
import { deepEntries, runDeep } from "./extract/deep.js";
import type { DeepReport, MetaEntry, Report } from "./types.js";

export const filesDir = path.join(config.dataDir, "files");
fs.mkdirSync(filesDir, { recursive: true });

export interface FileRow {
  id: string;
  original_name: string;
  declared_mime: string | null;
  detected_ext: string | null;
  detected_mime: string | null;
  created_at: string;
}

export interface VersionRow {
  id: string;
  file_id: string;
  number: number;
  storage_path: string;
  size: number;
  md5: string;
  sha1: string;
  sha256: string;
  note: string | null;
  created_at: string;
}

/** Never trust the client name for the on-disk path. Keep only a safe extension. */
export function safeExt(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : "";
}

export function getFileRow(id: string) {
  return db.prepare(`SELECT * FROM files WHERE id = ?`).get(id) as FileRow | undefined;
}

/** Extract metadata for a file on disk without storing anything. */
/** Directory for files derived from a version (extracted previews, thumbnails). */
export function derivedDir(fileId: string, versionNumber: number) {
  return path.join(filesDir, fileId, "derived", `v${versionNumber}`);
}

/**
 * Full analysis of a file on disk. Deep extractors always run so version diffs stay
 * consistent; previews are only written out when `derived` is given.
 */
export async function analyzePath(absPath: string, file: FileRow, derived?: { fileId: string; version: number }) {
  const { entries: exif, warnings } = await extractExif(absPath);
  const deep = await runDeep(absPath, {
    mime: file.detected_mime,
    ext: file.detected_ext,
    entries: exif,
    outDir: derived ? derivedDir(derived.fileId, derived.version) : undefined,
    urlFor: derived ? (name) => `/api/files/${derived.fileId}/derived/${derived.version}/${name}` : undefined,
  });
  const entries = [...exif, ...deepEntries(deep)];
  const report = buildReport(entries, {
    originalName: file.original_name,
    detectedExt: file.detected_ext ?? undefined,
    detectedMime: file.detected_mime ?? undefined,
    warnings: [...warnings, ...deep.errors],
    deep,
  });
  return { entries, report, deep };
}

async function analyzeVersion(versionId: string, absPath: string, file: FileRow) {
  const { number } = db.prepare(`SELECT number FROM versions WHERE id = ?`).get(versionId) as { number: number };
  const { entries, report, deep } = await analyzePath(absPath, file, { fileId: file.id, version: number });
  db.prepare(
    `INSERT OR REPLACE INTO metadata (version_id, entries_json, report_json, deep_json, exiftool_version, extracted_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(versionId, JSON.stringify(entries), JSON.stringify(report), JSON.stringify(deep), await exiftoolVersion(), new Date().toISOString());
}

/**
 * Store `srcAbs` as the next version of a file (moving it into storage) and analyze it.
 * Returns the new version number.
 */
export async function addVersion(file: FileRow, srcAbs: string, note: string, userId?: string): Promise<number> {
  const last = getVersion(file.id);
  const number = (last?.number ?? 0) + 1;
  const ext = last ? path.extname(last.storage_path) : safeExt(file.original_name);
  const rel = path.join(file.id, `v${number}${ext}`);
  const abs = path.join(filesDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.renameSync(srcAbs, abs);
  const [hashes, stat] = await Promise.all([hashFile(abs), fs.promises.stat(abs)]);
  const versionId = randomUUID();
  db.prepare(
    `INSERT INTO versions (id, file_id, number, storage_path, size, md5, sha1, sha256, note, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(versionId, file.id, number, rel, stat.size, hashes.md5, hashes.sha1, hashes.sha256, note, new Date().toISOString(), userId ?? null);
  try {
    await analyzeVersion(versionId, abs, file);
  } catch (err) {
    db.prepare(`DELETE FROM versions WHERE id = ?`).run(versionId);
    fs.rmSync(abs, { force: true });
    throw err;
  }
  return number;
}

/** Takes ownership of `tmpPath` (moves it into storage). */
export async function ingestFile(tmpPath: string, originalName: string, projectId: string, declaredMime?: string, userId?: string) {
  const id = randomUUID();
  try {
    const ft = await fileTypeFromFile(tmpPath).catch(() => undefined);
    const file: FileRow = {
      id,
      original_name: originalName,
      declared_mime: declaredMime ?? null,
      detected_ext: ft?.ext ?? null,
      detected_mime: ft?.mime ?? null,
      created_at: new Date().toISOString(),
    };
    db.prepare(`INSERT INTO files (id, original_name, declared_mime, detected_ext, detected_mime, created_at, uploaded_by, project_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(file.id, file.original_name, file.declared_mime, file.detected_ext, file.detected_mime, file.created_at, userId ?? null, projectId);
    await addVersion(file, tmpPath, "Оригінал", userId);
    return (await getFile(id))!;
  } catch (err) {
    deleteFile(id);
    throw err;
  }
}

export interface FileListRow {
  id: string;
  original_name: string;
  detected_mime: string | null;
  created_at: string;
  size: number;
  version: number;
  project_id: string;
  project_name: string;
  counts: Report["counts"] | null;
}

/** Files in the given projects, newest first. */
export function listFiles(projectIds: Set<string>): FileListRow[] {
  if (projectIds.size === 0) return [];
  const ids = [...projectIds];
  const rows = db
    .prepare(
      `SELECT f.id, f.original_name, f.detected_mime, f.created_at, v.size, v.number AS version,
              f.project_id, p.name AS project_name,
              json_extract(m.report_json, '$.counts') AS counts
       FROM files f
       JOIN versions v ON v.file_id = f.id AND v.number = (SELECT MAX(number) FROM versions WHERE file_id = f.id)
       LEFT JOIN metadata m ON m.version_id = v.id
       JOIN projects p ON p.id = f.project_id
       WHERE f.project_id IN (${ids.map(() => "?").join(",")})
       ORDER BY f.created_at DESC`,
    )
    .all(...ids) as unknown as (Omit<FileListRow, "counts"> & { counts: string | null })[];
  return rows.map((r) => ({ ...r, counts: r.counts ? JSON.parse(r.counts) : null }));
}

export function getVersion(fileId: string, number?: number): VersionRow | undefined {
  const row = number
    ? db.prepare(`SELECT * FROM versions WHERE file_id = ? AND number = ?`).get(fileId, number)
    : db.prepare(`SELECT * FROM versions WHERE file_id = ? ORDER BY number DESC LIMIT 1`).get(fileId);
  return row as VersionRow | undefined;
}

export function getEntries(versionId: string): MetaEntry[] {
  const row = db.prepare(`SELECT entries_json FROM metadata WHERE version_id = ?`).get(versionId) as { entries_json: string } | undefined;
  return row ? JSON.parse(row.entries_json) : [];
}

export async function getFile(id: string, versionNumber?: number) {
  const file = getFileRow(id);
  if (!file) return undefined;
  const version = getVersion(id, versionNumber);
  const latest = getVersion(id);
  if (!version || !latest) return undefined;
  const versions = db
    .prepare(`SELECT v.number, v.size, v.sha256, v.note, v.created_at, u.display_name AS author
       FROM versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.file_id = ? ORDER BY v.number`)
    .all(id);
  const meta = db.prepare(`SELECT * FROM metadata WHERE version_id = ?`).get(version.id) as
    | { entries_json: string; report_json: string; deep_json: string | null; exiftool_version: string; extracted_at: string }
    | undefined;
  const entries = meta ? (JSON.parse(meta.entries_json) as MetaEntry[]) : [];

  // Writability is computed at read time so older extractions benefit from new rules.
  const fileType = entries.find((e) => e.group === "File" && e.tag === "FileTypeExtension")?.raw ?? file.detected_ext;
  const canWrite = await canWriteFileType(String(fileType ?? ""));
  for (const e of entries) e.writable = canWrite && (await isTagWritable(e.group, e.tag));

  return {
    file,
    version: { ...version, storage_path: undefined },
    isLatest: version.number === latest.number,
    canWrite,
    versions,
    exiftoolVersion: meta?.exiftool_version,
    extractedAt: meta?.extracted_at,
    report: meta ? (JSON.parse(meta.report_json) as Report) : null,
    deep: meta?.deep_json ? (JSON.parse(meta.deep_json) as DeepReport) : null,
    entries,
  };
}

export function versionPath(v: VersionRow) {
  return path.join(filesDir, v.storage_path);
}

export function deleteFile(id: string) {
  db.prepare(`DELETE FROM files WHERE id = ?`).run(id);
  fs.rmSync(path.join(filesDir, id), { recursive: true, force: true });
}

export async function reanalyze(id: string) {
  const file = getFileRow(id);
  const v = getVersion(id);
  if (!file || !v) return undefined;
  await analyzeVersion(v.id, versionPath(v), file);
  return getFile(id);
}
