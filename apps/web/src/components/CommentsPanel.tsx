import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, can, type CommentView, type Role, type Thread, type User } from "../api";
import { MentionInput, type MentionInputHandle } from "./MentionInput";

interface Props {
  fileId: string;
  role: Role;
  version: number;
  me: User;
  users: User[];
  threads: Thread[];
  /** Field the user picked in the table; new threads attach to it. */
  focusField: string | null;
  onFocusField: (fp: string | null) => void;
  onChanged: () => void;
}

type Filter = "open" | "resolved" | "all";

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "щойно";
  if (s < 3600) return `${Math.round(s / 60)} хв тому`;
  if (s < 86400) return `${Math.round(s / 3600)} год тому`;
  return new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** "EXIF:IFD0:Artist" → "Artist (EXIF › IFD0)" */
export function fieldLabel(fp: string) {
  const [g, sg, t] = fp.split(":");
  return `${t} (${g}${sg && sg !== g ? ` › ${sg}` : ""})`;
}

function Body({ text, users }: { text: string; users: User[] }) {
  const known = useMemo(() => new Set(users.map((u) => u.username.toLowerCase())), [users]);
  const parts = text.split(/(@[\w.-]{3,32})/g);
  return (
    <div className="c-body">
      {parts.map((p, i) =>
        p.startsWith("@") && known.has(p.slice(1).toLowerCase()) ? (
          <span key={i} className="mention">{p}</span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </div>
  );
}

export function CommentsPanel({ fileId, role, version, me, users, threads, focusField, onFocusField, onChanged }: Props) {
  const canComment = can(role, "commenter");
  const isOwner = can(role, "owner");
  const [filter, setFilter] = useState<Filter>("open");
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composer = useRef<MentionInputHandle>(null);
  const root = useRef<HTMLElement>(null);

  // When a field is picked in the table, bring the composer into view.
  useEffect(() => {
    if (!focusField) return;
    root.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => composer.current?.focus(), 300);
  }, [focusField]);

  const visible = threads.filter((t) => {
    if (focusField && t.field_path !== focusField) return false;
    if (filter === "all") return true;
    return t.status === filter;
  });
  const openCount = threads.filter((t) => t.status === "open").length;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const post = async () => {
    if (!draft.trim()) return;
    const ok = await run(() => api.addComment(fileId, { body: draft, fieldPath: focusField ?? undefined, version }));
    if (ok) setDraft("");
  };

  const reply = async (threadId: string) => {
    if (!replyDraft.trim()) return;
    const ok = await run(() => api.addComment(fileId, { body: replyDraft, parentId: threadId, version }));
    if (ok) {
      setReplyDraft("");
      setReplyTo(null);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const ok = await run(() => api.editComment(editing.id, editing.text));
    if (ok) setEditing(null);
  };

  const remove = (c: CommentView) => {
    if (confirm("Видалити коментар?")) run(() => api.deleteComment(c.id));
  };

  const renderComment = (c: CommentView, isRoot: boolean, t?: Thread) => (
    <div className={`comment ${isRoot ? "root" : "reply"}`} key={c.id}>
      <div className="c-head">
        <span className="avatar sm" aria-hidden>{c.author.name.slice(0, 1).toUpperCase()}</span>
        <strong>{c.author.name}</strong>
        <span className="muted small" title={new Date(c.created_at).toLocaleString("uk-UA")}>
          {timeAgo(c.created_at)}
          {c.edited && " · змінено"}
          {c.version_number && ` · v${c.version_number}`}
        </span>
        {isRoot && t?.status === "resolved" && <span className="pill ok">закрито</span>}
      </div>
      {c.deleted ? (
        <div className="c-body muted"><em>Коментар видалено</em></div>
      ) : editing?.id === c.id ? (
        <div className="c-edit">
          <MentionInput value={editing.text} onChange={(v) => setEditing({ id: c.id, text: v })} onSubmit={saveEdit} users={users} autoFocus rows={2} />
          <div className="c-actions">
            <button className="btn small-btn primary" disabled={busy} onClick={saveEdit}>Зберегти</button>
            <button className="btn small-btn" onClick={() => setEditing(null)}>Скасувати</button>
          </div>
        </div>
      ) : (
        <Body text={c.body} users={users} />
      )}
      {!c.deleted && editing?.id !== c.id && (
        <div className="c-actions">
          {isRoot && t && canComment && (
            <>
              <button className="link-btn" onClick={() => { setReplyTo(t.id); setReplyDraft(""); }}>Відповісти</button>
              <button className="link-btn" onClick={() => run(() => api.setThreadStatus(t.id, t.status === "open" ? "resolved" : "open"))}>
                {t.status === "open" ? "Закрити обговорення" : "Відкрити знову"}
              </button>
            </>
          )}
          {canComment && c.author.id === me.id && <button className="link-btn" onClick={() => setEditing({ id: c.id, text: c.body })}>Редагувати</button>}
          {((canComment && c.author.id === me.id) || isOwner) && <button className="link-btn danger" onClick={() => remove(c)}>Видалити</button>}
        </div>
      )}
    </div>
  );

  return (
    <section className="card comments-card" ref={root}>
      <div className="c-toolbar">
        <h2>Коментарі {openCount > 0 && <span className="pill comments">{openCount} відкр.</span>}</h2>
        <div className="seg" role="tablist">
          {(["open", "resolved", "all"] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f === "open" ? "Відкриті" : f === "resolved" ? "Закриті" : "Усі"}
            </button>
          ))}
        </div>
      </div>

      {!canComment && <p className="muted small readonly-note">Твоя роль у проєкті — «Глядач»: коментарі можна лише читати.</p>}
      {canComment && (
      <div className="composer">
        {focusField && (
          <div className="field-target">
            До поля <strong>{fieldLabel(focusField)}</strong>
            <button className="link-btn" onClick={() => onFocusField(null)}>до всього файлу</button>
          </div>
        )}
        <MentionInput
          ref={composer}
          value={draft}
          onChange={setDraft}
          onSubmit={post}
          users={users}
          placeholder={focusField ? "Що не так із цим полем? @ — згадати колегу" : "Коментар до файлу… @ — згадати колегу"}
        />
        <div className="composer-foot">
          <span className="muted small">Ctrl+Enter — надіслати</span>
          <button className="btn primary small-btn" disabled={busy || !draft.trim()} onClick={post}>Надіслати</button>
        </div>
        {error && <p className="error-text small" role="alert">{error}</p>}
      </div>
      )}

      <div className="threads">
        {visible.length === 0 && (
          <p className="muted small pad-s">
            {focusField ? "До цього поля ще немає коментарів." : filter === "open" ? "Відкритих обговорень немає." : "Коментарів немає."}
          </p>
        )}
        {visible.map((t) => (
          <article key={t.id} className={`thread ${t.status}`}>
            {t.field_path && (
              <button className="field-badge" onClick={() => onFocusField(t.field_path)} title="Показати лише коментарі до цього поля">
                {fieldLabel(t.field_path)}
              </button>
            )}
            {renderComment(t, true, t)}
            {t.replies.length > 0 && <div className="replies">{t.replies.map((r) => renderComment(r, false))}</div>}
            {replyTo === t.id && (
              <div className="reply-box">
                <MentionInput value={replyDraft} onChange={setReplyDraft} onSubmit={() => reply(t.id)} users={users} autoFocus rows={2} placeholder="Відповідь…" />
                <div className="c-actions">
                  <button className="btn small-btn primary" disabled={busy || !replyDraft.trim()} onClick={() => reply(t.id)}>Відповісти</button>
                  <button className="btn small-btn" onClick={() => setReplyTo(null)}>Скасувати</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
