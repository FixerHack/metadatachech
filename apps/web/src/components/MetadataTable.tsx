import { useMemo, useState } from "react";
import { fieldPath, formatValue, writeTag, type EditOp, type MetaEntry, type Risk } from "../api";

type RiskFilter = "all" | Risk | "risky";

interface Props {
  entries: MetaEntry[];
  /** Editing is possible (latest version of a writable file type). */
  editable: boolean;
  pending: EditOp[];
  onOp: (op: EditOp) => void;
  onUndo: (tag: string) => void;
  /** Comment threads per field path. */
  fieldThreads: Map<string, { open: number; total: number }>;
  onComment: (fieldPath: string) => void;
  /** Viewers only get the button where threads already exist (to read them). */
  canComment: boolean;
}

/** Common tags offered when adding a new one. */
const SUGGESTED_TAGS = [
  "Artist", "Copyright", "ImageDescription", "UserComment", "Software", "Make", "Model",
  "DateTimeOriginal", "CreateDate", "ModifyDate",
  "XMP-dc:Title", "XMP-dc:Description", "XMP-dc:Creator", "XMP-dc:Rights", "XMP-dc:Subject",
  "IPTC:Keywords", "IPTC:By-line", "IPTC:CopyrightNotice", "IPTC:Caption-Abstract", "IPTC:City", "IPTC:Country-PrimaryLocationName",
];

export function MetadataTable({ entries, editable, pending, onOp, onUndo, fieldThreads, onComment, canComment }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string>("all");
  const [risk, setRisk] = useState<RiskFilter>("all");
  const [showRaw, setShowRaw] = useState(false);
  const [onlyWritable, setOnlyWritable] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; tag: string; value: string } | null>(null);
  const [adding, setAdding] = useState<{ tag: string; value: string } | null>(null);

  /** Pending set/delete by lower-cased write tag. */
  const pendingByTag = useMemo(() => {
    const m = new Map<string, EditOp>();
    for (const op of pending) if (op.kind === "set" || op.kind === "delete") m.set(op.tag.toLowerCase(), op);
    return m;
  }, [pending]);

  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.group, (m.get(e.group) ?? 0) + 1);
    return [...m.entries()];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (group !== "all" && e.group !== group) return false;
      if (onlyWritable && !e.writable) return false;
      if (risk === "risky" && e.risk === "low") return false;
      if (risk !== "all" && risk !== "risky" && e.risk !== risk) return false;
      if (!q) return true;
      return (
        e.tag.toLowerCase().includes(q) ||
        e.subgroup.toLowerCase().includes(q) ||
        formatValue(e.value).toLowerCase().includes(q) ||
        formatValue(e.raw).toLowerCase().includes(q)
      );
    });
  }, [entries, query, group, risk, onlyWritable]);

  const sections = useMemo(() => {
    const m = new Map<string, MetaEntry[]>();
    for (const e of filtered) {
      const key = `${e.group} › ${e.subgroup}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return [...m.entries()];
  }, [filtered]);

  /** New tags the user is adding that don't exist in the file yet. */
  const existing = useMemo(() => new Set(entries.map((e) => writeTag(e).toLowerCase())), [entries]);
  const newTags = pending.filter(
    (op): op is Extract<EditOp, { kind: "set" }> => op.kind === "set" && !existing.has(op.tag.toLowerCase()),
  );

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
  };

  const commitEdit = () => {
    if (!editing) return;
    onOp({ kind: "set", tag: editing.tag, value: editing.value });
    setEditing(null);
  };

  const commitAdd = () => {
    if (!adding || !adding.tag.trim()) return;
    onOp({ kind: "set", tag: adding.tag.trim(), value: adding.value });
    setAdding(null);
  };

  const cols = showRaw ? 5 : 4;

  return (
    <section className="card table-card">
      <div className="table-toolbar">
        <h2>Усі метадані</h2>
        <input
          className="search"
          type="search"
          placeholder="Пошук за тегом або значенням…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={risk} onChange={(e) => setRisk(e.target.value as RiskFilter)} aria-label="Фільтр ризику">
          <option value="all">Усі рівні</option>
          <option value="risky">Лише ризикові</option>
          <option value="high">Високий</option>
          <option value="medium">Середній</option>
          <option value="low">Низький</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> Сирі значення
        </label>
        {editable && (
          <label className="check">
            <input type="checkbox" checked={onlyWritable} onChange={(e) => setOnlyWritable(e.target.checked)} /> Лише редаговані
          </label>
        )}
      </div>

      <div className="chips">
        <button className={`chip ${group === "all" ? "active" : ""}`} onClick={() => setGroup("all")}>
          Усі <span>{entries.length}</span>
        </button>
        {groups.map(([g, n]) => (
          <button key={g} className={`chip ${group === g ? "active" : ""}`} onClick={() => setGroup(g)}>
            {g} <span>{n}</span>
          </button>
        ))}
      </div>

      <div className="table-sub">
        <p className="muted small">
          Показано {filtered.length} з {entries.length}. Клік по значенню копіює його.
          {editable && " Олівець — змінити, × — видалити."} 💬 — обговорити поле.
        </p>
        {editable && !adding && (
          <button className="btn small-btn" onClick={() => setAdding({ tag: "", value: "" })}>
            + Додати тег
          </button>
        )}
      </div>

      {adding && (
        <form
          className="add-tag"
          onSubmit={(e) => {
            e.preventDefault();
            commitAdd();
          }}
        >
          <input
            autoFocus
            list="tag-suggestions"
            placeholder="Тег, напр. XMP-dc:Title або Copyright"
            value={adding.tag}
            onChange={(e) => setAdding({ ...adding, tag: e.target.value })}
          />
          <datalist id="tag-suggestions">
            {SUGGESTED_TAGS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <input placeholder="Значення" value={adding.value} onChange={(e) => setAdding({ ...adding, value: e.target.value })} />
          <button className="btn primary" type="submit" disabled={!adding.tag.trim()}>Додати</button>
          <button className="btn" type="button" onClick={() => setAdding(null)}>Скасувати</button>
        </form>
      )}

      <div className="table-wrap">
        <table className="meta">
          <thead>
            <tr>
              <th className="col-risk" aria-label="Ризик" />
              <th>Тег</th>
              <th>Значення</th>
              {showRaw && <th>Сире</th>}
              <th className="col-actions" aria-label="Дії" />
            </tr>
          </thead>
          {newTags.length > 0 && (
            <tbody>
              <tr className="section-row static">
                <td colSpan={cols}>Нові теги</td>
              </tr>
              {newTags.map((op) => (
                <tr key={op.tag} className="pending-set">
                  <td className="col-risk"><span className="risk-dot" /></td>
                  <td className="tag">{op.tag}</td>
                  <td className="value"><span className="new-val">{String(op.value)}</span></td>
                  {showRaw && <td />}
                  <td className="col-actions">
                    <button className="icon-btn" title="Скасувати" onClick={() => onUndo(op.tag)}>↺</button>
                  </td>
                </tr>
              ))}
            </tbody>
          )}
          {sections.map(([key, rows]) => {
            const isCollapsed = collapsed.has(key);
            return (
              <tbody key={key}>
                <tr className="section-row" onClick={() => toggle(key)}>
                  <td colSpan={cols}>
                    <span className="caret">{isCollapsed ? "▸" : "▾"}</span> {key} <span className="muted">({rows.length})</span>
                  </td>
                </tr>
                {!isCollapsed &&
                  rows.map((e, i) => {
                    const rowKey = `${key}:${e.tag}:${i}`;
                    const wt = writeTag(e);
                    const op = pendingByTag.get(wt.toLowerCase());
                    const val = formatValue(e.value);
                    const isEditing = editing?.key === rowKey;
                    const canEdit = editable && e.writable && !e.binary;
                    return (
                      <tr key={rowKey} className={`risk-${e.risk} ${op ? `pending-${op.kind}` : ""}`}>
                        <td className="col-risk">
                          <span className={`risk-dot ${e.risk}`} title={e.riskReason ?? "Низький ризик"} />
                        </td>
                        <td className="tag">
                          {e.tag}
                          {e.riskReason && <div className="reason">{e.riskReason}</div>}
                        </td>
                        {isEditing ? (
                          <td className="value editing">
                            <textarea
                              autoFocus
                              rows={Math.min(6, Math.max(1, Math.ceil(editing.value.length / 60)))}
                              value={editing.value}
                              onChange={(ev) => setEditing({ ...editing, value: ev.target.value })}
                              onKeyDown={(ev) => {
                                if (ev.key === "Enter" && !ev.shiftKey) {
                                  ev.preventDefault();
                                  commitEdit();
                                }
                                if (ev.key === "Escape") setEditing(null);
                              }}
                            />
                            <div className="edit-hint">Enter — застосувати · Shift+Enter — новий рядок · Esc — скасувати</div>
                          </td>
                        ) : (
                          <td className={`value ${e.binary ? "muted" : ""}`} onClick={() => copy(rowKey, val)}>
                            {copied === rowKey ? (
                              <span className="copied">Скопійовано</span>
                            ) : op?.kind === "set" ? (
                              <>
                                <s className="old-val">{val}</s> <span className="new-val">{String(op.value)}</span>
                              </>
                            ) : op?.kind === "delete" ? (
                              <s className="old-val">{val}</s>
                            ) : (
                              val
                            )}
                          </td>
                        )}
                        {showRaw && <td className="value mono muted">{e.raw !== undefined ? formatValue(e.raw) : ""}</td>}
                        <td className="col-actions">
                          {(() => {
                            const fp = fieldPath(e);
                            const c = fieldThreads.get(fp);
                            if (!c && !canComment) return null;
                            return (
                              <button
                                className={`icon-btn comment-btn ${c ? (c.open ? "has-open" : "has") : ""}`}
                                title={c ? `Обговорень: ${c.total}, відкритих: ${c.open}` : "Обговорити це поле"}
                                onClick={() => onComment(fp)}
                              >
                                💬{c && <span className="cnt">{c.total}</span>}
                              </button>
                            );
                          })()}
                          {op ? (
                            <button className="icon-btn" title="Скасувати зміну" onClick={() => onUndo(wt)}>↺</button>
                          ) : canEdit && !isEditing ? (
                            <>
                              <button className="icon-btn" title="Змінити" onClick={() => setEditing({ key: rowKey, tag: wt, value: val })}>✎</button>
                              <button className="icon-btn danger" title="Видалити тег" onClick={() => onOp({ kind: "delete", tag: wt })}>×</button>
                            </>
                          ) : isEditing ? (
                            <button className="icon-btn" title="Застосувати" onClick={commitEdit}>✓</button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            );
          })}
        </table>
        {filtered.length === 0 && <p className="muted pad">Нічого не знайдено.</p>}
      </div>
    </section>
  );
}
