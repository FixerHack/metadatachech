import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { EditError } from "../edit/ops.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = "mc_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  username: string;
  display_name: string;
  is_admin: number;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
  }
}

class AuthError extends EditError {
  statusCode = 401;
}

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scryptAsync(pw, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export function publicUser(u: User) {
  return { id: u.id, username: u.username, display_name: u.display_name, is_admin: !!u.is_admin };
}

export async function register(username: unknown, password: unknown, displayName: unknown) {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    throw new EditError("Логін: 3–32 символи, латиниця, цифри, . _ -");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    throw new EditError("Пароль має бути від 8 символів");
  }
  const name = typeof displayName === "string" && displayName.trim() ? displayName.trim().slice(0, 60) : username;
  if (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) throw new EditError("Такий логін уже зайнятий");
  const isFirst = !(db.prepare(`SELECT 1 FROM users LIMIT 1`).get());
  const user: User = { id: randomUUID(), username, display_name: name, is_admin: isFirst ? 1 : 0 };
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(user.id, user.username, user.display_name, await hashPassword(password), user.is_admin, new Date().toISOString());
  return user;
}

export async function login(username: unknown, password: unknown) {
  const row = typeof username === "string"
    ? (db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as (User & { password_hash: string }) | undefined)
    : undefined;
  // Always run scrypt so timing doesn't reveal whether the username exists.
  const ok = await verifyPassword(String(password ?? ""), row?.password_hash ?? "scrypt$AAAA$AAAA");
  if (!row || !ok) throw new AuthError("Невірний логін або пароль");
  return row as User;
}

export function createSession(userId: string): { token: string; maxAge: number } {
  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 86400;
  db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
    .run(sha256(token), userId, new Date(Date.now() + maxAge * 1000).toISOString(), new Date().toISOString());
  db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString());
  return { token, maxAge };
}

export function destroySession(token: string) {
  db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(sha256(token));
}

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setSessionCookie(reply: FastifyReply, token: string, maxAge: number) {
  // HttpOnly + SameSite=Lax: not readable by scripts and not sent on cross-site POSTs.
  reply.header("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function userFromRequest(req: FastifyRequest): User | undefined {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return undefined;
  return db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), new Date().toISOString()) as User | undefined;
}

const PUBLIC_ROUTES = [/^\/api\/health$/, /^\/api\/auth\/(login|register|me)$/];

/** Fastify onRequest hook: every /api route except the public ones needs a session. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const url = req.url.split("?")[0];
  if (!url.startsWith("/api/")) return;
  req.user = userFromRequest(req);
  if (req.user || PUBLIC_ROUTES.some((re) => re.test(url))) return;
  return reply.code(401).send({ error: "Потрібно увійти" });
}

export function listUsers() {
  return (db.prepare(`SELECT id, username, display_name, is_admin FROM users ORDER BY display_name`).all() as unknown as User[]).map(publicUser);
}

export function userCount() {
  return (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
}
