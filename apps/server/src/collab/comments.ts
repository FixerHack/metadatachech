import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { EditError } from "../edit/ops.js";
import { getFileRow } from "../files.js";
import type { User } from "./auth.js";
import { audit, broadcast } from "./events.js";
import { fileRole, requireFile } from "./access.js";

class NotFound extends EditError {
  statusCode = 404;
}
class Forbidden extends EditError {
  statusCode = 403;
}

export const LABELS = {
  suspicious: "Підозріле",
  verified: "Перевірено",
  fake: "Підробка",
  needs_review: "Потребує перевірки",
} as const;
export type Label = keyof typeof LABELS;

interface Row {
  id: string;
  file_id: string;
  parent_id: string | null;
  version_number: number | null;
  field_path: string | null;
  author_id: string;
  author_name: string;
  author_username: string;
  body: string;
  status: "open" | "resolved";
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

// Tag part may contain dots (ffprobe tags like "com.apple.quicktime.make").
const FIELD_PATH_RE = /^[\w-]+:[\w-]+:[\w.-]+$/;
const MENTION_RE = /(^|[^\w@])@([a-zA-Z0-9_.-]{3,32})/g;

function mentionedUserIds(body: string, fileId: string): string[] {
  const names = new Set([...body.matchAll(MENTION_RE)].map((m) => m[2].toLowerCase()));
  if (!names.size) return [];
  const ids: string[] = [];
  for (const n of names) {
    const u = db.prepare(`SELECT id, is_admin FROM users WHERE username = ?`).get(n) as { id: string; is_admin: number } | undefined;
    // Only notify people who can actually open the file.
    if (u && fileRole(u, fileId)) ids.push(u.id);
  }
  return ids;
}

function getRow(id: string) {
  return db.prepare(`SELECT * FROM comments WHERE id = ?`).get(id) as
    | { id: string; file_id: string; parent_id: string | null; author_id: string; deleted_at: string | null }
    | undefined;
}

function validBody(body: unknown) {
  if (typeof body !== "string" || !body.trim()) throw new EditError("Коментар порожній");
  if (body.length > 10_000) throw new EditError("Коментар задовгий (макс. 10 000 символів)");
  return body.trim();
}

/** Threads for a file: roots with their replies, oldest first. Deleted comments keep their place. */
export function listThreads(fileId: string) {
  const rows = db
    .prepare(
      `SELECT c.*, a.display_name AS author_name, a.username AS author_username, r.display_name AS resolved_by_name
       FROM comments c
       JOIN users a ON a.id = c.author_id
       LEFT JOIN users r ON r.id = c.resolved_by
       WHERE c.file_id = ? ORDER BY c.created_at`,
    )
    .all(fileId) as unknown as Row[];

  const view = (r: Row) => ({
    id: r.id,
    parent_id: r.parent_id,
    version_number: r.version_number,
    field_path: r.field_path,
    author: { id: r.author_id, name: r.author_name, username: r.author_username },
    body: r.deleted_at ? "" : r.body,
    deleted: !!r.deleted_at,
    edited: !!r.updated_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  });

  const roots = rows.filter((r) => !r.parent_id);
  return roots
    .map((root) => ({
      ...view(root),
      status: root.status,
      resolved_by: root.resolved_by_name,
      resolved_at: root.resolved_at,
      replies: rows.filter((r) => r.parent_id === root.id).map(view),
    }))
    // A deleted root with no live replies is just noise.
    .filter((t) => !t.deleted || t.replies.some((r) => !r.deleted));
}

export function createComment(user: User, fileId: string, input: { body?: unknown; parentId?: unknown; fieldPath?: unknown; version?: unknown }) {
  requireFile(user, fileId, "commenter");
  if (!getFileRow(fileId)) throw new NotFound("Файл не знайдено");
  const body = validBody(input.body);
  let parentId: string | null = null;
  let fieldPath: string | null = null;

  if (input.parentId != null) {
    const parent = getRow(String(input.parentId));
    if (!parent || parent.file_id !== fileId) throw new NotFound("Гілку не знайдено");
    // Replies always attach to the thread root (one level of nesting).
    parentId = parent.parent_id ?? parent.id;
    db.prepare(`UPDATE comments SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = ? AND status = 'resolved'`).run(parentId);
  } else if (input.fieldPath != null && input.fieldPath !== "") {
    if (typeof input.fieldPath !== "string" || !FIELD_PATH_RE.test(input.fieldPath)) throw new EditError("Некоректне поле");
    fieldPath = input.fieldPath;
  }
  const version = Number.isInteger(input.version) ? (input.version as number) : null;

  const id = randomUUID();
  db.prepare(
    `INSERT INTO comments (id, file_id, parent_id, version_number, field_path, author_id, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, fileId, parentId, version, fieldPath, user.id, body, new Date().toISOString());

  for (const uid of mentionedUserIds(body, fileId)) {
    if (uid === user.id) continue;
    db.prepare(`INSERT OR IGNORE INTO mentions (comment_id, user_id) VALUES (?, ?)`).run(id, uid);
    broadcast({ type: "mention", userId: uid });
  }
  audit(user.id, fileId, parentId ? "comment.reply" : "comment.create", { commentId: id, fieldPath });
  broadcast({ type: "comment", fileId, commentId: id, action: "create", by: user.id });
  return { id };
}

export function editComment(user: User, id: string, body: unknown) {
  const row = getRow(id);
  if (!row || row.deleted_at) throw new NotFound("Коментар не знайдено");
  requireFile(user, row.file_id, "commenter");
  if (row.author_id !== user.id) throw new Forbidden("Редагувати можна лише свої коментарі");
  const text = validBody(body);
  db.prepare(`UPDATE comments SET body = ?, updated_at = ? WHERE id = ?`).run(text, new Date().toISOString(), id);
  for (const uid of mentionedUserIds(text, row.file_id)) {
    if (uid !== user.id) db.prepare(`INSERT OR IGNORE INTO mentions (comment_id, user_id) VALUES (?, ?)`).run(id, uid);
  }
  audit(user.id, row.file_id, "comment.edit", { commentId: id });
  broadcast({ type: "comment", fileId: row.file_id, commentId: id, action: "edit", by: user.id });
}

export function deleteComment(user: User, id: string) {
  const row = getRow(id);
  if (!row || row.deleted_at) throw new NotFound("Коментар не знайдено");
  const role = requireFile(user, row.file_id, "commenter");
  if (row.author_id !== user.id && role !== "owner") throw new Forbidden("Видаляти чужі коментарі може лише власник проєкту");
  db.prepare(`UPDATE comments SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  db.prepare(`DELETE FROM mentions WHERE comment_id = ?`).run(id);
  audit(user.id, row.file_id, "comment.delete", { commentId: id });
  broadcast({ type: "comment", fileId: row.file_id, commentId: id, action: "delete", by: user.id });
}

export function setThreadStatus(user: User, id: string, status: unknown) {
  if (status !== "open" && status !== "resolved") throw new EditError("Статус: open або resolved");
  const row = getRow(id);
  if (!row || row.parent_id) throw new NotFound("Гілку не знайдено");
  requireFile(user, row.file_id, "commenter");
  if (status === "resolved") {
    db.prepare(`UPDATE comments SET status = 'resolved', resolved_by = ?, resolved_at = ? WHERE id = ?`).run(user.id, new Date().toISOString(), id);
  } else {
    db.prepare(`UPDATE comments SET status = 'open', resolved_by = NULL, resolved_at = NULL WHERE id = ?`).run(id);
  }
  audit(user.id, row.file_id, status === "resolved" ? "thread.resolve" : "thread.reopen", { commentId: id });
  broadcast({ type: "comment", fileId: row.file_id, commentId: id, action: status, by: user.id });
}

// ---- Labels ---------------------------------------------------------------------

export function fileLabels(fileId: string) {
  return db
    .prepare(
      `SELECT l.label, l.created_at, u.display_name AS user_name FROM file_labels l JOIN users u ON u.id = l.user_id
       WHERE l.file_id = ? ORDER BY l.created_at`,
    )
    .all(fileId);
}

export function setLabel(user: User, fileId: string, label: unknown, on: boolean) {
  if (typeof label !== "string" || !(label in LABELS)) throw new EditError("Невідома мітка");
  requireFile(user, fileId, "commenter");
  if (on) {
    // "verified" and "fake" contradict each other.
    const opposite = label === "verified" ? "fake" : label === "fake" ? "verified" : null;
    if (opposite) db.prepare(`DELETE FROM file_labels WHERE file_id = ? AND label = ?`).run(fileId, opposite);
    db.prepare(`INSERT OR IGNORE INTO file_labels (file_id, label, user_id, created_at) VALUES (?, ?, ?, ?)`).run(fileId, label, user.id, new Date().toISOString());
  } else {
    db.prepare(`DELETE FROM file_labels WHERE file_id = ? AND label = ?`).run(fileId, label);
  }
  audit(user.id, fileId, on ? "label.add" : "label.remove", { label });
  broadcast({ type: "label", fileId });
  return fileLabels(fileId);
}

// ---- Mentions inbox ---------------------------------------------------------------

export function myMentions(user: User) {
  return db
    .prepare(
      `SELECT m.comment_id, m.read_at, c.file_id, c.body, c.created_at, c.field_path, f.original_name AS file_name,
              a.display_name AS author_name
       FROM mentions m
       JOIN comments c ON c.id = m.comment_id AND c.deleted_at IS NULL
       JOIN files f ON f.id = c.file_id
       JOIN users a ON a.id = c.author_id
       WHERE m.user_id = ? ORDER BY c.created_at DESC LIMIT 100`,
    )
    .all(user.id)
    .filter((m) => fileRole(user, String(m.file_id)))
    .slice(0, 50);
}

export function markMentionsRead(user: User, fileId?: string) {
  if (fileId) {
    db.prepare(
      `UPDATE mentions SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND comment_id IN (SELECT id FROM comments WHERE file_id = ?)`,
    ).run(new Date().toISOString(), user.id, fileId);
  } else {
    db.prepare(`UPDATE mentions SET read_at = ? WHERE user_id = ? AND read_at IS NULL`).run(new Date().toISOString(), user.id);
  }
}

/** Per-file counters for the sidebar. */
export function collabSummary() {
  const counts = db
    .prepare(
      `SELECT file_id,
              SUM(CASE WHEN parent_id IS NULL AND status = 'open' AND deleted_at IS NULL THEN 1 ELSE 0 END) AS open_threads,
              SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) AS comments
       FROM comments GROUP BY file_id`,
    )
    .all() as { file_id: string; open_threads: number; comments: number }[];
  const labels = db.prepare(`SELECT file_id, label FROM file_labels`).all() as { file_id: string; label: string }[];
  const out = new Map<string, { open_threads: number; comments: number; labels: string[] }>();
  for (const c of counts) out.set(c.file_id, { open_threads: c.open_threads, comments: c.comments, labels: [] });
  for (const l of labels) {
    if (!out.has(l.file_id)) out.set(l.file_id, { open_threads: 0, comments: 0, labels: [] });
    out.get(l.file_id)!.labels.push(l.label);
  }
  return out;
}
