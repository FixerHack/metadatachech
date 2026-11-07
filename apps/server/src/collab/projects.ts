import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { EditError } from "../edit/ops.js";
import type { User } from "./auth.js";
import { Forbidden, NotFoundError, isRole, projectRole, requireFile, requireProject, visibleProjectIds, type Role } from "./access.js";
import { audit } from "./events.js";

function validName(name: unknown) {
  if (typeof name !== "string" || !name.trim()) throw new EditError("Вкажи назву проєкту");
  if (name.trim().length > 80) throw new EditError("Назва задовга (макс. 80 символів)");
  return name.trim();
}

function validDescription(d: unknown) {
  if (d == null || d === "") return null;
  if (typeof d !== "string") throw new EditError("Некоректний опис");
  return d.trim().slice(0, 500) || null;
}

export function listProjects(user: User) {
  const ids = visibleProjectIds(user);
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.description, p.created_at,
              (SELECT COUNT(*) FROM files f WHERE f.project_id = p.id) AS file_count,
              (SELECT COUNT(*) FROM project_members m WHERE m.project_id = p.id) AS member_count
       FROM projects p ORDER BY p.name COLLATE NOCASE`,
    )
    .all() as { id: string; name: string; description: string | null; created_at: string; file_count: number; member_count: number }[];
  return rows.filter((r) => ids.has(r.id)).map((r) => ({ ...r, role: projectRole(user, r.id) }));
}

export function createProject(user: User, name: unknown, description: unknown) {
  const p = { id: randomUUID(), name: validName(name), description: validDescription(description) };
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO projects (id, name, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).run(p.id, p.name, p.description, user.id, now);
    db.prepare(`INSERT INTO project_members (project_id, user_id, role, added_by, added_at) VALUES (?, ?, 'owner', ?, ?)`).run(p.id, user.id, user.id, now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  audit(user.id, null, "project.create", { projectId: p.id, name: p.name });
  return { ...p, role: "owner" as Role };
}

export function updateProject(user: User, projectId: string, input: { name?: unknown; description?: unknown }) {
  requireProject(user, projectId, "owner");
  if (input.name !== undefined) db.prepare(`UPDATE projects SET name = ? WHERE id = ?`).run(validName(input.name), projectId);
  if (input.description !== undefined) db.prepare(`UPDATE projects SET description = ? WHERE id = ?`).run(validDescription(input.description), projectId);
  audit(user.id, null, "project.update", { projectId });
}

export function deleteProject(user: User, projectId: string) {
  requireProject(user, projectId, "owner");
  const n = (db.prepare(`SELECT COUNT(*) AS n FROM files WHERE project_id = ?`).get(projectId) as { n: number }).n;
  if (n > 0) throw new EditError(`У проєкті ${n} файл(ів). Спершу видали або перенеси їх.`);
  db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  audit(user.id, null, "project.delete", { projectId });
}

export function listMembers(user: User, projectId: string) {
  requireProject(user, projectId, "viewer");
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_admin, m.role, m.added_at
       FROM project_members m JOIN users u ON u.id = m.user_id
       WHERE m.project_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 WHEN 'commenter' THEN 2 ELSE 3 END, u.display_name`,
    )
    .all(projectId)
    .map((r) => ({ ...r, is_admin: !!r.is_admin }));
}

function ownerCount(projectId: string) {
  return (db.prepare(`SELECT COUNT(*) AS n FROM project_members WHERE project_id = ? AND role = 'owner'`).get(projectId) as { n: number }).n;
}

function currentRole(projectId: string, userId: string) {
  return (db.prepare(`SELECT role FROM project_members WHERE project_id = ? AND user_id = ?`).get(projectId, userId) as { role: Role } | undefined)?.role;
}

/** Adds a member or changes their role. */
export function setMember(user: User, projectId: string, userId: string, role: unknown) {
  requireProject(user, projectId, "owner");
  if (!isRole(role)) throw new EditError("Невідома роль");
  if (!db.prepare(`SELECT 1 FROM users WHERE id = ?`).get(userId)) throw new NotFoundError("Користувача не знайдено");
  const before = currentRole(projectId, userId);
  if (before === "owner" && role !== "owner" && ownerCount(projectId) <= 1) {
    throw new Forbidden("У проєкті має лишитися хоча б один власник");
  }
  db.prepare(
    `INSERT INTO project_members (project_id, user_id, role, added_by, added_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = excluded.role`,
  ).run(projectId, userId, role, user.id, new Date().toISOString());
  audit(user.id, null, before ? "member.role" : "member.add", { projectId, userId, role, before: before ?? null });
}

export function removeMember(user: User, projectId: string, userId: string) {
  // Anyone may leave a project; removing others needs owner.
  if (userId !== user.id) requireProject(user, projectId, "owner");
  else if (!currentRole(projectId, userId)) throw new NotFoundError("Ти не учасник цього проєкту");
  if (currentRole(projectId, userId) === "owner" && ownerCount(projectId) <= 1) {
    throw new Forbidden("Не можна прибрати останнього власника");
  }
  db.prepare(`DELETE FROM project_members WHERE project_id = ? AND user_id = ?`).run(projectId, userId);
  audit(user.id, null, "member.remove", { projectId, userId });
}

/** Moves a file between projects; needs editor in both. */
export function moveFile(user: User, fileId: string, targetProjectId: unknown) {
  requireFile(user, fileId, "editor");
  if (typeof targetProjectId !== "string") throw new EditError("Вкажи проєкт");
  requireProject(user, targetProjectId, "editor");
  const from = db.prepare(`SELECT project_id FROM files WHERE id = ?`).get(fileId) as { project_id: string };
  if (from.project_id === targetProjectId) return { from: from.project_id, to: targetProjectId };
  db.prepare(`UPDATE files SET project_id = ? WHERE id = ?`).run(targetProjectId, fileId);
  audit(user.id, fileId, "file.move", { from: from.project_id, to: targetProjectId });
  return { from: from.project_id, to: targetProjectId };
}
