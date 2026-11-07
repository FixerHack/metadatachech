import { db } from "../db.js";
import { EditError } from "../edit/ops.js";
import type { User } from "./auth.js";

/**
 * viewer    — read files, metadata, comments, activity; download and export
 * commenter — viewer + comment, resolve threads, set labels
 * editor    — commenter + upload, edit metadata, revert, reanalyze, delete files
 * owner     — editor + manage members, rename and delete the project
 * Admins act as owner everywhere.
 */
export type Role = "viewer" | "commenter" | "editor" | "owner";
export const ROLES: Role[] = ["viewer", "commenter", "editor", "owner"];
const RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Глядач",
  commenter: "Коментатор",
  editor: "Редактор",
  owner: "Власник",
};

export class Forbidden extends EditError {
  statusCode = 403;
}
export class NotFoundError extends EditError {
  statusCode = 404;
}

export function isRole(x: unknown): x is Role {
  return typeof x === "string" && (ROLES as string[]).includes(x);
}

export function atLeast(role: Role | null, min: Role): boolean {
  return !!role && RANK[role] >= RANK[min];
}

export function projectExists(projectId: string) {
  return !!db.prepare(`SELECT 1 FROM projects WHERE id = ?`).get(projectId);
}

export function projectRole(user: Pick<User, "id" | "is_admin">, projectId: string): Role | null {
  if (!projectExists(projectId)) return null;
  if (user.is_admin) return "owner";
  const row = db.prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`).get(projectId, user.id) as
    | { role: Role }
    | undefined;
  return row?.role ?? null;
}

export function fileProjectId(fileId: string): string | null {
  const row = db.prepare(`SELECT project_id FROM files WHERE id = ?`).get(fileId) as { project_id: string | null } | undefined;
  return row?.project_id ?? null;
}

export function fileRole(user: Pick<User, "id" | "is_admin">, fileId: string): Role | null {
  const pid = fileProjectId(fileId);
  return pid ? projectRole(user, pid) : null;
}

const NEED: Record<Role, string> = {
  viewer: "перегляду",
  commenter: "коментування",
  editor: "редагування",
  owner: "керування проєктом",
};

/**
 * Throws 404 when the user can't see the file at all (so its existence isn't revealed)
 * and 403 when they can see it but their role is too low.
 */
export function requireFile(user: User, fileId: string, min: Role): Role {
  const role = fileRole(user, fileId);
  if (!role) throw new NotFoundError("Файл не знайдено");
  if (!atLeast(role, min)) throw new Forbidden(`Недостатньо прав: потрібна роль для ${NEED[min]}`);
  return role;
}

export function requireProject(user: User, projectId: string, min: Role): Role {
  const role = projectRole(user, projectId);
  if (!role) throw new NotFoundError("Проєкт не знайдено");
  if (!atLeast(role, min)) throw new Forbidden(`Недостатньо прав: потрібна роль для ${NEED[min]}`);
  return role;
}

/** Project ids the user can see; admins see all. */
export function visibleProjectIds(user: Pick<User, "id" | "is_admin">): Set<string> {
  const rows = user.is_admin
    ? (db.prepare(`SELECT id FROM projects`).all() as { id: string }[])
    : (db.prepare(`SELECT project_id AS id FROM project_members WHERE user_id = ?`).all(user.id) as { id: string }[]);
  return new Set(rows.map((r) => r.id));
}
