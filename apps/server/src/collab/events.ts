import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { fileRole, projectRole } from "./access.js";
import type { User } from "./auth.js";

/** What changed; clients refetch what they display. */
export type AppEvent =
  | { type: "file"; fileId: string; action: string }
  | { type: "files"; projectId: string }
  | { type: "projects" }
  | { type: "comment"; fileId: string; commentId: string; action: string }
  | { type: "label"; fileId: string }
  | { type: "mention"; userId: string };

interface Client {
  user: User;
  reply: FastifyReply;
}

const clients = new Set<Client>();

/** Events only reach users who can see what changed. */
function canSee(user: User, e: AppEvent): boolean {
  switch (e.type) {
    case "mention": return e.userId === user.id;
    case "projects": return true; // carries no data; clients refetch their own list
    case "files": return !!projectRole(user, e.projectId);
    default: return !!fileRole(user, e.fileId);
  }
}

export function broadcast(event: AppEvent & { by?: string }) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) {
    if (!canSee(c.user, event)) continue;
    c.reply.raw.write(data);
  }
}

/** GET /api/events — Server-Sent Events stream. */
export function eventsHandler(req: FastifyRequest, reply: FastifyReply) {
  reply.hijack();
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(`retry: 3000\n\n`);
  const client: Client = { user: req.user!, reply };
  clients.add(client);
  const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
  req.raw.on("close", () => {
    clearInterval(ping);
    clients.delete(client);
  });
}

export function closeAllEventStreams() {
  for (const c of clients) c.reply.raw.end();
  clients.clear();
}

// ---- Audit log ----------------------------------------------------------------

export function audit(userId: string | undefined, fileId: string | null, action: string, details?: unknown) {
  db.prepare(`INSERT INTO audit_log (user_id, file_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    userId ?? null,
    fileId,
    action,
    details === undefined ? null : JSON.stringify(details),
    new Date().toISOString(),
  );
}

export function fileAudit(fileId: string, limit = 200) {
  return db
    .prepare(
      `SELECT a.id, a.action, a.details, a.created_at, u.display_name AS user_name, u.username
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.file_id = ? ORDER BY a.id DESC LIMIT ?`,
    )
    .all(fileId, limit)
    .map((r) => ({ ...r, details: r.details ? JSON.parse(String(r.details)) : null }));
}
