import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `--lan`: listen on every network interface and serve the built web app from this server. */
const lan = process.argv.includes("--lan");

export const config = {
  lan,
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? (lan ? "0.0.0.0" : "127.0.0.1"),
  /** Root for the SQLite DB and stored files. */
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(here, "..", "..", "..", "data")),
  /** Built frontend (apps/web/dist); served only in LAN mode. */
  webDist: path.resolve(process.env.WEB_DIST ?? path.join(here, "..", "..", "web", "dist")),
  /** Max upload size per file, bytes. */
  maxFileSize: Number(process.env.MAX_FILE_SIZE ?? 500 * 1024 * 1024),
  maxFilesPerRequest: 20,
  /** Login/register attempts allowed per client IP per window. */
  authAttempts: Number(process.env.AUTH_ATTEMPTS ?? 10),
  authWindowMs: 5 * 60 * 1000,
};
