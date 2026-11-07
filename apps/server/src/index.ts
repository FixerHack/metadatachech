import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";
import { et } from "./extract/exiftool.js";
import { deleteFile, derivedDir, getFile, getFileRow, getVersion, ingestFile, listFiles, reanalyze, versionPath } from "./files.js";
import { fileTypeFromFile } from "file-type";
import { readBytes } from "./extract/trailer.js";
import { applyEdit, batchEdit, diffVersions, previewEdit, revertTo } from "./edit/engine.js";
import { EditError, PRESETS, validateOps } from "./edit/ops.js";
import { createTemplate, deleteTemplate, listTemplates } from "./edit/templates.js";
import {
  SESSION_COOKIE, clearSessionCookie, createSession, destroySession, listUsers, login, publicUser, readCookie,
  register, requireAuth, setSessionCookie, userCount, type User,
} from "./collab/auth.js";
import {
  LABELS, collabSummary, createComment, deleteComment, editComment, fileLabels, listThreads, markMentionsRead,
  myMentions, setLabel, setThreadStatus,
} from "./collab/comments.js";
import { audit, broadcast, closeAllEventStreams, eventsHandler, fileAudit } from "./collab/events.js";
import { authRateLimit } from "./collab/ratelimit.js";
import fastifyStatic from "@fastify/static";
import { ROLE_LABELS, fileProjectId, requireFile, requireProject, visibleProjectIds } from "./collab/access.js";
import {
  createProject, deleteProject, listMembers, listProjects, moveFile, removeMember, setMember, updateProject,
} from "./collab/projects.js";

const app = Fastify({ logger: { level: "info" }, bodyLimit: 1024 * 1024 });

await app.register(cors, { origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/], credentials: true });
await app.register(multipart, {
  limits: { fileSize: config.maxFileSize, files: config.maxFilesPerRequest, fields: 10 },
});

app.addHook("onRequest", requireAuth);

app.setErrorHandler((err, req, reply) => {
  const e = err as Error & { statusCode?: number };
  const status = e instanceof EditError ? e.statusCode : e.statusCode && e.statusCode < 500 ? e.statusCode : 500;
  if (status >= 500) req.log.error(err);
  reply.code(status).send({ error: status >= 500 ? `Помилка сервера: ${e.message}` : e.message });
});

/** Authenticated user; the onRequest hook guarantees it on non-public routes. */
const me = (req: { user?: User }) => req.user!;
const versionParam = (v?: string) => (v ? Number(v) : undefined);

app.get("/api/health", async () => ({ ok: true, exiftool: await et.version() }));

// ---- Auth -------------------------------------------------------------------

app.get("/api/auth/me", async (req) => ({ user: req.user ? publicUser(req.user) : null, firstRun: userCount() === 0 }));

app.post<{ Body: { username?: string; password?: string; displayName?: string } }>("/api/auth/register", { onRequest: authRateLimit }, async (req, reply) => {
  const user = await register(req.body?.username, req.body?.password, req.body?.displayName);
  const s = createSession(user.id);
  setSessionCookie(reply, s.token, s.maxAge);
  audit(user.id, null, "user.register");
  return { user: publicUser(user) };
});

app.post<{ Body: { username?: string; password?: string } }>("/api/auth/login", { onRequest: authRateLimit }, async (req, reply) => {
  const user = await login(req.body?.username, req.body?.password);
  const s = createSession(user.id);
  setSessionCookie(reply, s.token, s.maxAge);
  return { user: publicUser(user) };
});

app.post("/api/auth/logout", async (req, reply) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) destroySession(token);
  clearSessionCookie(reply);
  return { ok: true };
});

app.get("/api/users", async () => listUsers());

app.get("/api/events", (req, reply) => eventsHandler(req, reply));

// ---- Projects -----------------------------------------------------------------

app.get("/api/roles", async () => Object.entries(ROLE_LABELS).map(([id, label]) => ({ id, label })));

app.get("/api/projects", async (req) => listProjects(me(req)));

app.post<{ Body: { name?: unknown; description?: unknown } }>("/api/projects", async (req) => {
  const p = createProject(me(req), req.body?.name, req.body?.description);
  broadcast({ type: "projects", by: me(req).id });
  return p;
});

app.patch<{ Params: { pid: string }; Body: { name?: unknown; description?: unknown } }>("/api/projects/:pid", async (req) => {
  updateProject(me(req), req.params.pid, req.body ?? {});
  broadcast({ type: "projects", by: me(req).id });
  return { ok: true };
});

app.delete<{ Params: { pid: string } }>("/api/projects/:pid", async (req) => {
  deleteProject(me(req), req.params.pid);
  broadcast({ type: "projects", by: me(req).id });
  return { ok: true };
});

app.get<{ Params: { pid: string } }>("/api/projects/:pid/members", async (req) => listMembers(me(req), req.params.pid));

app.put<{ Params: { pid: string; uid: string }; Body: { role?: unknown } }>("/api/projects/:pid/members/:uid", async (req) => {
  setMember(me(req), req.params.pid, req.params.uid, req.body?.role);
  broadcast({ type: "projects", by: me(req).id });
  return listMembers(me(req), req.params.pid);
});

app.delete<{ Params: { pid: string; uid: string } }>("/api/projects/:pid/members/:uid", async (req) => {
  removeMember(me(req), req.params.pid, req.params.uid);
  broadcast({ type: "projects", by: me(req).id });
  return { ok: true };
});

// ---- Files --------------------------------------------------------------------

app.get<{ Querystring: { project?: string } }>("/api/files", async (req) => {
  let ids = visibleProjectIds(me(req));
  if (req.query.project) {
    requireProject(me(req), req.query.project, "viewer");
    ids = new Set([req.query.project]);
  }
  const collab = collabSummary();
  return listFiles(ids).map((f) => ({ ...f, collab: collab.get(f.id) ?? { open_threads: 0, comments: 0, labels: [] } }));
});

app.post<{ Querystring: { project?: string } }>("/api/files", async (req, reply) => {
  const projectId = req.query.project;
  if (!projectId) throw new EditError("Обери проєкт, у який завантажувати");
  requireProject(me(req), projectId, "editor");

  const results: unknown[] = [];
  const errors: { name: string; error: string }[] = [];
  for await (const part of req.files()) {
    const tmp = path.join(os.tmpdir(), `mc-${randomUUID()}`);
    try {
      await pipeline(part.file, fs.createWriteStream(tmp));
      if (part.file.truncated) throw new Error(`Файл перевищує ліміт ${Math.round(config.maxFileSize / 1024 / 1024)} МБ`);
      const res = await ingestFile(tmp, part.filename || "file", projectId, part.mimetype, me(req).id);
      audit(me(req).id, res.file.id, "file.upload", { name: res.file.original_name });
      results.push({ id: res.file.id, name: res.file.original_name });
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      req.log.warn({ err, name: part.filename }, "ingest failed");
      errors.push({ name: part.filename, error: (err as Error).message });
    }
  }
  if (results.length) broadcast({ type: "files", projectId, by: me(req).id });
  if (!results.length && errors.length) return reply.code(400).send({ results, errors });
  return { results, errors };
});

async function fileDetail(user: User, id: string, version?: number) {
  const role = requireFile(user, id, "viewer");
  const res = await getFile(id, version);
  if (!res) throw new EditError("Не знайдено");
  const pid = fileProjectId(id)!;
  const project = listProjects(user).find((p) => p.id === pid);
  return { ...res, labels: fileLabels(id), role, project: project ? { id: project.id, name: project.name } : { id: pid, name: "" } };
}

app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/api/files/:id", async (req) =>
  fileDetail(me(req), req.params.id, versionParam(req.query.version)),
);

app.post<{ Params: { id: string } }>("/api/files/:id/reanalyze", async (req) => {
  requireFile(me(req), req.params.id, "editor");
  await reanalyze(req.params.id);
  audit(me(req).id, req.params.id, "file.reanalyze");
  return fileDetail(me(req), req.params.id);
});

app.post<{ Params: { id: string }; Body: { projectId?: unknown } }>("/api/files/:id/move", async (req) => {
  const r = moveFile(me(req), req.params.id, req.body?.projectId);
  broadcast({ type: "files", projectId: r.from, by: me(req).id });
  broadcast({ type: "files", projectId: r.to, by: me(req).id });
  return fileDetail(me(req), req.params.id);
});

app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/api/files/:id/export.json", async (req, reply) => {
  const res = await fileDetail(me(req), req.params.id, versionParam(req.query.version));
  const base = path.parse(res.file.original_name).name.replace(/[^\w.-]+/g, "_");
  reply.header("Content-Disposition", `attachment; filename="${base}.metadata.json"`);
  return { ...res, comments: listThreads(req.params.id) };
});

app.get<{ Params: { id: string }; Querystring: { version?: string } }>("/api/files/:id/download", async (req, reply) => {
  requireFile(me(req), req.params.id, "viewer");
  const file = getFileRow(req.params.id);
  const v = getVersion(req.params.id, versionParam(req.query.version));
  if (!file || !v) return reply.code(404).send({ error: "Не знайдено" });
  audit(me(req).id, file.id, "file.download", { version: v.number });
  const name = encodeURIComponent(file.original_name);
  reply.header("Content-Disposition", `attachment; filename*=UTF-8''${name}`);
  reply.type("application/octet-stream");
  return reply.send(fs.createReadStream(versionPath(v)));
});

// Extracted previews and the main-image thumbnail for one version.
app.get<{ Params: { id: string; version: string; name: string } }>("/api/files/:id/derived/:version/:name", async (req, reply) => {
  requireFile(me(req), req.params.id, "viewer");
  const version = Number(req.params.version);
  // Only names we generate: "<Tag>.bin" or "main.webp" — no path segments.
  if (!Number.isInteger(version) || version < 1 || !/^[A-Za-z]+\.(bin|webp)$/.test(req.params.name)) {
    return reply.code(400).send({ error: "Некоректний шлях" });
  }
  const abs = path.join(derivedDir(req.params.id, version), req.params.name);
  if (!fs.existsSync(abs)) return reply.code(404).send({ error: "Не знайдено" });
  const ft = await fileTypeFromFile(abs).catch(() => undefined);
  const displayable = ft && /^image\/(jpeg|png|webp|gif)$/.test(ft.mime);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", "default-src 'none'");
  reply.header("Cache-Control", "private, max-age=3600");
  if (!displayable) reply.header("Content-Disposition", `attachment; filename="${req.params.name.replace(/\.bin$/, `.${ft?.ext ?? "bin"}`)}"`);
  reply.type(displayable ? ft!.mime : "application/octet-stream");
  return reply.send(fs.createReadStream(abs));
});

app.get<{ Params: { id: string }; Querystring: { version?: string; offset?: string; length?: string } }>("/api/files/:id/hex", async (req, reply) => {
  requireFile(me(req), req.params.id, "viewer");
  const v = getVersion(req.params.id, versionParam(req.query.version));
  if (!v) return reply.code(404).send({ error: "Не знайдено" });
  const offset = Math.max(0, Math.floor(Number(req.query.offset ?? 0)) || 0);
  const length = Math.min(64 * 1024, Math.max(16, Math.floor(Number(req.query.length ?? 4096)) || 4096));
  return readBytes(versionPath(v), offset, length);
});

app.delete<{ Params: { id: string } }>("/api/files/:id", async (req) => {
  requireFile(me(req), req.params.id, "editor");
  const file = getFileRow(req.params.id);
  const projectId = fileProjectId(req.params.id);
  deleteFile(req.params.id);
  if (file && projectId) {
    audit(me(req).id, null, "file.delete", { fileId: file.id, name: file.original_name, projectId });
    broadcast({ type: "files", projectId, by: me(req).id });
  }
  return { ok: true };
});

// ---- Editing ----------------------------------------------------------------

app.get("/api/presets", async () =>
  Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, description: p.description })),
);

type EditBody = { ops?: unknown; note?: string };

app.post<{ Params: { id: string }; Body: EditBody }>("/api/files/:id/preview", async (req) => {
  requireFile(me(req), req.params.id, "editor");
  return previewEdit(req.params.id, validateOps(req.body?.ops));
});

app.post<{ Params: { id: string }; Body: EditBody }>("/api/files/:id/edit", async (req) => {
  requireFile(me(req), req.params.id, "editor");
  const ops = validateOps(req.body?.ops);
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : undefined;
  const res = await applyEdit(req.params.id, ops, note, me(req).id);
  if (res.created) {
    audit(me(req).id, req.params.id, "file.edit", { version: res.version, ops, changes: res.diff.length });
    broadcast({ type: "file", fileId: req.params.id, action: "edit", by: me(req).id });
  }
  return { ...res, detail: await fileDetail(me(req), req.params.id) };
});

app.post<{ Params: { id: string }; Body: { version?: number } }>("/api/files/:id/revert", async (req) => {
  requireFile(me(req), req.params.id, "editor");
  const n = Number(req.body?.version);
  if (!Number.isInteger(n) || n < 1) throw new EditError("Вкажи номер версії");
  const res = await revertTo(req.params.id, n, me(req).id);
  audit(me(req).id, req.params.id, "file.revert", { to: n, version: res.version });
  broadcast({ type: "file", fileId: req.params.id, action: "revert", by: me(req).id });
  return { ...res, detail: await fileDetail(me(req), req.params.id) };
});

app.get<{ Params: { id: string }; Querystring: { a?: string; b?: string } }>("/api/files/:id/diff", async (req) => {
  requireFile(me(req), req.params.id, "viewer");
  const a = Number(req.query.a), b = Number(req.query.b);
  if (!Number.isInteger(a) || !Number.isInteger(b)) throw new EditError("Потрібні параметри a і b");
  return diffVersions(req.params.id, a, b);
});

app.post<{ Body: EditBody & { ids?: string[] } }>("/api/batch/edit", async (req) => {
  const ops = validateOps(req.body?.ops);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  // Files the user can't edit are reported per file, not silently skipped.
  const denied: { id: string; ok: false; error: string }[] = [];
  const allowed: string[] = [];
  for (const id of ids) {
    try {
      requireFile(me(req), id, "editor");
      allowed.push(id);
    } catch (e) {
      denied.push({ id, ok: false, error: (e as Error).message });
    }
  }
  const results = allowed.length ? await batchEdit(allowed, ops, req.body?.note, me(req).id) : [];
  for (const r of results) {
    if (r.ok && r.created) {
      audit(me(req).id, String(r.id), "file.edit", { version: r.version, ops, batch: true });
      broadcast({ type: "file", fileId: String(r.id), action: "edit", by: me(req).id });
    }
  }
  if (!ids.length) throw new EditError("Не вибрано жодного файлу");
  return { results: [...results, ...denied] };
});

app.get("/api/templates", async () => listTemplates());
app.post<{ Body: { name?: unknown; ops?: unknown } }>("/api/templates", async (req) => createTemplate(req.body?.name, req.body?.ops));
app.delete<{ Params: { id: string } }>("/api/templates/:id", async (req) => {
  deleteTemplate(req.params.id);
  return { ok: true };
});

// ---- Comments, labels, activity ---------------------------------------------

app.get<{ Params: { id: string } }>("/api/files/:id/comments", async (req) => {
  requireFile(me(req), req.params.id, "viewer");
  return listThreads(req.params.id);
});

app.post<{ Params: { id: string }; Body: { body?: unknown; parentId?: unknown; fieldPath?: unknown; version?: unknown } }>(
  "/api/files/:id/comments",
  async (req) => createComment(me(req), req.params.id, req.body ?? {}),
);

app.patch<{ Params: { cid: string }; Body: { body?: unknown; status?: unknown } }>("/api/comments/:cid", async (req) => {
  if (req.body?.status !== undefined) setThreadStatus(me(req), req.params.cid, req.body.status);
  if (req.body?.body !== undefined) editComment(me(req), req.params.cid, req.body.body);
  return { ok: true };
});

app.delete<{ Params: { cid: string } }>("/api/comments/:cid", async (req) => {
  deleteComment(me(req), req.params.cid);
  return { ok: true };
});

app.get("/api/labels", async () => Object.entries(LABELS).map(([id, label]) => ({ id, label })));

app.put<{ Params: { id: string; label: string } }>("/api/files/:id/labels/:label", async (req) =>
  setLabel(me(req), req.params.id, req.params.label, true),
);
app.delete<{ Params: { id: string; label: string } }>("/api/files/:id/labels/:label", async (req) =>
  setLabel(me(req), req.params.id, req.params.label, false),
);

app.get<{ Params: { id: string } }>("/api/files/:id/activity", async (req) => {
  requireFile(me(req), req.params.id, "viewer");
  return fileAudit(req.params.id);
});

app.get("/api/mentions", async (req) => myMentions(me(req)));
app.post<{ Body: { fileId?: string } }>("/api/mentions/read", async (req) => {
  markMentionsRead(me(req), req.body?.fileId);
  return { ok: true };
});

const shutdown = async () => {
  closeAllEventStreams();
  await app.close();
  await et.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---- LAN mode: serve the built web app from this same port --------------------

if (config.lan) {
  if (!fs.existsSync(path.join(config.webDist, "index.html"))) {
    throw new Error(`Немає зібраного фронтенду в ${config.webDist}. Запусти: npm run build --workspace apps/web`);
  }
  await app.register(fastifyStatic, { root: config.webDist, prefix: "/", index: ["index.html"], wildcard: false });
  // SPA fallback: unknown non-API paths get the app shell; unknown API paths stay JSON 404s.
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.method !== "GET") return reply.code(404).send({ error: "Не знайдено" });
    return reply.sendFile("index.html");
  });
}

await app.listen({ port: config.port, host: config.host });

if (config.lan) {
  const urls = Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list ?? []).filter((a) => a.family === "IPv4" && !a.internal).map((a) => `  http://${a.address}:${config.port}   (${name})`));
  app.log.info(`MetaCheck доступний у локальній мережі:\n${urls.join("\n")}`);
}
