import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

/** In-memory sliding window per IP; enough to stop password guessing on a local network. */
const hits = new Map<string, number[]>();

export function authRateLimit(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const now = Date.now();
  const ip = req.ip;
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < config.authWindowMs);
  if (recent.length >= config.authAttempts) {
    const retry = Math.ceil((config.authWindowMs - (now - recent[0])) / 1000);
    reply.header("Retry-After", String(retry));
    reply.code(429).send({ error: `Забагато спроб. Спробуй через ${Math.ceil(retry / 60)} хв.` });
    return;
  }
  recent.push(now);
  hits.set(ip, recent);
  done();
}

// Drop stale entries so the map can't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (list.every((t) => now - t >= config.authWindowMs)) hits.delete(ip);
}, 60_000).unref();
