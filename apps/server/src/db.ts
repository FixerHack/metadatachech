import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "metadatacheck.db"));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS files (
  id            TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  declared_mime TEXT,
  detected_ext  TEXT,
  detected_mime TEXT,
  created_at    TEXT NOT NULL
);

-- Every edit produces a new immutable version (version 1 = the original upload).
CREATE TABLE IF NOT EXISTS versions (
  id           TEXT PRIMARY KEY,
  file_id      TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  number       INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  size         INTEGER NOT NULL,
  md5          TEXT NOT NULL,
  sha1         TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (file_id, number)
);

CREATE TABLE IF NOT EXISTS metadata (
  version_id       TEXT PRIMARY KEY REFERENCES versions(id) ON DELETE CASCADE,
  entries_json     TEXT NOT NULL,
  report_json      TEXT NOT NULL,
  exiftool_version TEXT,
  extracted_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_file ON versions(file_id, number);

-- ---- Collaboration ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- Only a hash of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- A root comment (parent_id NULL) starts a thread; replies point at the root.
-- field_path ties a thread to one metadata field, e.g. "EXIF:IFD0:Artist".
CREATE TABLE IF NOT EXISTS comments (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  parent_id      TEXT REFERENCES comments(id) ON DELETE CASCADE,
  version_number INTEGER,
  field_path     TEXT,
  author_id      TEXT NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  resolved_by    TEXT REFERENCES users(id),
  resolved_at    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  deleted_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_file ON comments(file_id, created_at);

CREATE TABLE IF NOT EXISTS mentions (
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TEXT,
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE IF NOT EXISTS file_labels (
  file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (file_id, label)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  file_id    TEXT,
  action     TEXT NOT NULL,
  details    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_file ON audit_log(file_id, id);
`);

/** Adds a column to an existing table if it is missing (simple forward-only migration). */
function addColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn("versions", "created_by", "created_by TEXT REFERENCES users(id)");
addColumn("files", "uploaded_by", "uploaded_by TEXT REFERENCES users(id)");
addColumn("metadata", "deep_json", "deep_json TEXT");

// ---- Projects & roles ---------------------------------------------------------

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),
  added_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  added_at   TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON project_members(user_id);
`);
addColumn("files", "project_id", "project_id TEXT REFERENCES projects(id)");

// Files uploaded before projects existed go into a shared default project.
{
  const orphans = (db.prepare(`SELECT COUNT(*) AS n FROM files WHERE project_id IS NULL`).get() as { n: number }).n;
  if (orphans > 0) {
    let def = db.prepare(`SELECT id FROM projects WHERE name = 'Загальний' ORDER BY created_at LIMIT 1`).get() as { id: string } | undefined;
    if (!def) {
      def = { id: crypto.randomUUID() };
      db.prepare(`INSERT INTO projects (id, name, description, created_at) VALUES (?, 'Загальний', 'Файли, завантажені до появи проєктів', ?)`)
        .run(def.id, new Date().toISOString());
    }
    db.prepare(`UPDATE files SET project_id = ? WHERE project_id IS NULL`).run(def.id);
  }
}
