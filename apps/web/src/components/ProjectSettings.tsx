import { useCallback, useEffect, useMemo, useState } from "react";
import { api, can, ROLE_HINTS, ROLE_LABELS, type Member, type Project, type Role, type User } from "../api";

interface Props {
  /** Existing project to manage, or null to create a new one. */
  project: Project | null;
  me: User;
  onClose: () => void;
  /** Called after create/update/delete; `createdId` is set for a new project. */
  onChanged: (createdId?: string, deleted?: boolean) => void;
}

const ROLE_ORDER: Role[] = ["viewer", "commenter", "editor", "owner"];

export function ProjectSettings({ project, me, onClose, onChanged }: Props) {
  const isNew = !project;
  const isOwner = isNew || can(project.role, "owner");
  const [name, setName] = useState(project?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [addUser, setAddUser] = useState("");
  const [addRole, setAddRole] = useState<Role>("commenter");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembers = useCallback(() => {
    if (project) api.members(project.id).then(setMembers, (e) => setError(e.message));
  }, [project]);

  useEffect(() => {
    loadMembers();
    if (!isNew) api.users().then(setUsers, () => undefined);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loadMembers, isNew, onClose]);

  const candidates = useMemo(() => users.filter((u) => !members.some((m) => m.id === u.id)), [users, members]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (isNew) {
        const p = await api.createProject(name, description);
        onChanged(p.id);
        onClose();
      } else {
        await api.updateProject(project.id, { name, description });
        onChanged();
      }
    });

  const setRole = (userId: string, role: Role) =>
    run(async () => {
      setMembers(await api.setMember(project!.id, userId, role));
      onChanged();
    });

  const remove = (m: Member) => {
    const self = m.id === me.id;
    if (!confirm(self ? `Вийти з проєкту «${project!.name}»?` : `Прибрати ${m.display_name} з проєкту?`)) return;
    run(async () => {
      await api.removeMember(project!.id, m.id);
      if (self) {
        onChanged(undefined, true);
        onClose();
      } else {
        loadMembers();
        onChanged();
      }
    });
  };

  const add = () =>
    run(async () => {
      if (!addUser) return;
      setMembers(await api.setMember(project!.id, addUser, addRole));
      setAddUser("");
      onChanged();
    });

  const del = () => {
    if (!confirm(`Видалити проєкт «${project!.name}»? Це можна зробити лише з порожнім проєктом.`)) return;
    run(async () => {
      await api.deleteProject(project!.id);
      onChanged(undefined, true);
      onClose();
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal project-modal" role="dialog" aria-modal="true" aria-label={isNew ? "Новий проєкт" : "Налаштування проєкту"}>
        <header className="modal-head">
          <h2>{isNew ? "Новий проєкт" : project.name}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрити">×</button>
        </header>

        <div className="modal-body padded">
          <form
            className="project-form"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label>
              Назва
              <input autoFocus={isNew} value={name} maxLength={80} disabled={!isOwner} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Опис
              <textarea rows={2} value={description} maxLength={500} disabled={!isOwner} onChange={(e) => setDescription(e.target.value)} />
            </label>
            {isOwner && (
              <div>
                <button className="btn primary" disabled={busy || !name.trim()}>{isNew ? "Створити" : "Зберегти"}</button>
              </div>
            )}
          </form>

          {!isNew && (
            <>
              <h3>Учасники ({members.length})</h3>
              <ul className="members">
                {members.map((m) => (
                  <li key={m.id}>
                    <span className="avatar sm" aria-hidden>{m.display_name.slice(0, 1).toUpperCase()}</span>
                    <span className="m-name">
                      <strong>{m.display_name}</strong>
                      <span className="muted small">@{m.username}{m.id === me.id && " · це ти"}{m.is_admin && " · адмін"}</span>
                    </span>
                    {isOwner ? (
                      <select value={m.role} disabled={busy} onChange={(e) => setRole(m.id, e.target.value as Role)} aria-label={`Роль ${m.display_name}`}>
                        {ROLE_ORDER.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`role-pill ${m.role}`}>{ROLE_LABELS[m.role]}</span>
                    )}
                    {(isOwner || m.id === me.id) && (
                      <button className="icon-btn danger" title={m.id === me.id ? "Вийти з проєкту" : "Прибрати"} onClick={() => remove(m)}>×</button>
                    )}
                  </li>
                ))}
              </ul>

              {isOwner && (
                <div className="add-member">
                  <select value={addUser} onChange={(e) => setAddUser(e.target.value)} aria-label="Користувач">
                    <option value="">{candidates.length ? "Додати користувача…" : "Усі користувачі вже в проєкті"}</option>
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name} (@{u.username})</option>
                    ))}
                  </select>
                  <select value={addRole} onChange={(e) => setAddRole(e.target.value as Role)} aria-label="Роль">
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <button className="btn" disabled={busy || !addUser} onClick={add}>Додати</button>
                </div>
              )}

              <dl className="role-legend">
                {ROLE_ORDER.map((r) => (
                  <div key={r}>
                    <dt>{ROLE_LABELS[r]}</dt>
                    <dd>{ROLE_HINTS[r]}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {error && <p className="error-text small" role="alert">{error}</p>}
        </div>

        {!isNew && isOwner && (
          <footer className="modal-foot">
            <button className="btn danger" disabled={busy} onClick={del}>Видалити проєкт</button>
            <span className="muted small">Можна лише коли в ньому немає файлів.</span>
          </footer>
        )}
      </div>
    </div>
  );
}
