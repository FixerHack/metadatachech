import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { EditError, validateOps, type EditOp } from "./ops.js";

db.exec(`
CREATE TABLE IF NOT EXISTS templates (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  ops_json   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

interface Row {
  id: string;
  name: string;
  ops_json: string;
  created_at: string;
}

const toApi = (r: Row) => ({ id: r.id, name: r.name, ops: JSON.parse(r.ops_json) as EditOp[], created_at: r.created_at });

export function listTemplates() {
  return (db.prepare(`SELECT * FROM templates ORDER BY name`).all() as unknown as Row[]).map(toApi);
}

export function createTemplate(name: unknown, ops: unknown) {
  if (typeof name !== "string" || !name.trim() || name.length > 100) throw new EditError("Вкажи назву шаблону (до 100 символів)");
  const valid = validateOps(ops);
  const row: Row = { id: randomUUID(), name: name.trim(), ops_json: JSON.stringify(valid), created_at: new Date().toISOString() };
  db.prepare(`INSERT INTO templates (id, name, ops_json, created_at) VALUES (?, ?, ?, ?)`).run(row.id, row.name, row.ops_json, row.created_at);
  return toApi(row);
}

export function deleteTemplate(id: string) {
  db.prepare(`DELETE FROM templates WHERE id = ?`).run(id);
}
