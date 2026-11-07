import { useMemo, useState } from "react";
import { formatBytes, LABELS, ROLE_LABELS, type FileListItem, type Project, type User } from "../api";
import { BatchPanel } from "./BatchPanel";
import { Inbox } from "./Inbox";

interface Props {
  files: FileListItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onUpload: (files: File[]) => void;
  onBatchDone: () => void;
  uploading: boolean;
  user: User;
  onLogout: () => void;
  projects: Project[];
  current: string;
  onProject: (id: string) => void;
  onNewProject: () => void;
  onProjectSettings: () => void;
  uploadTarget: Project | null;
  /** Show each file's project name (when viewing all projects). */
  showProject: boolean;
}

export function Sidebar({
  files, selected, onSelect, onUpload, onBatchDone, uploading, user, onLogout,
  projects, current, onProject, onNewProject, onProjectSettings, uploadTarget, showProject,
}: Props) {
  const currentProject = projects.find((p) => p.id === current);
  const [over, setOver] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const names = useMemo(() => new Map(files.map((f) => [f.id, f.original_name])), [files]);
  const checkedIds = files.filter((f) => checked.has(f.id)).map((f) => f.id);

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <aside className="sidebar">
      <div className="side-top">
        <button className="brand" onClick={() => onSelect(null)}>
          <span className="brand-mark">M</span> MetaCheck
        </button>
        <Inbox onOpen={onSelect} />
      </div>

      <div className="project-switch">
        <select value={current} onChange={(e) => onProject(e.target.value)} aria-label="Проєкт">
          <option value="all">Усі проєкти ({projects.length})</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {ROLE_LABELS[p.role]}
            </option>
          ))}
        </select>
        {currentProject && (
          <button className="icon-btn" title="Налаштування й учасники" onClick={onProjectSettings}>⚙</button>
        )}
        <button className="icon-btn" title="Новий проєкт" onClick={onNewProject}>+</button>
      </div>
      {currentProject && (
        <p className="project-meta small muted">
          {currentProject.member_count} учасн. · {currentProject.file_count} файл(ів) · твоя роль:{" "}
          <span className={`role-pill ${currentProject.role}`}>{ROLE_LABELS[currentProject.role]}</span>
        </p>
      )}

      {uploadTarget ? (
      <label
        className={`drop ${over ? "over" : ""}`}
        title={`Завантаження в «${uploadTarget.name}»`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onUpload([...e.dataTransfer.files]);
        }}
      >
        <input type="file" multiple hidden onChange={(e) => onUpload([...(e.target.files ?? [])])} />
        {uploading ? "Аналізуємо…" : "+ Завантажити файли"}
        {current === "all" && <span className="drop-target small">у «{uploadTarget.name}»</span>}
      </label>
      ) : (
        <p className="drop disabled small">Завантаження недоступне: потрібна роль «Редактор»</p>
      )}

      {files.length > 1 && (
        <div className="list-head small muted">
          <span>Файли ({files.length})</span>
          <button
            className="link-btn"
            onClick={() => setChecked(checkedIds.length === files.length ? new Set() : new Set(files.map((f) => f.id)))}
          >
            {checkedIds.length === files.length ? "Зняти всі" : "Вибрати всі"}
          </button>
        </div>
      )}

      <div className="file-list">
        {files.length === 0 && <p className="muted small">Поки що порожньо</p>}
        {files.map((f) => (
          <div key={f.id} className={`file-item ${selected === f.id ? "active" : ""}`}>
            <input
              type="checkbox"
              checked={checked.has(f.id)}
              onChange={() => toggle(f.id)}
              aria-label={`Вибрати ${f.original_name}`}
            />
            <button className="file-open" onClick={() => onSelect(f.id)}>
              <span className="file-name" title={f.original_name}>{f.original_name}</span>
              {showProject && <span className="file-project small">{f.project_name}</span>}
              <span className="file-meta">
                {formatBytes(f.size)} · {f.counts?.total ?? 0} тегів
                {f.version > 1 && <> · v{f.version}</>}
                {f.counts && f.counts.high > 0 && <span className="pill high" title="Полів з високим ризиком">{f.counts.high}</span>}
                {f.collab.open_threads > 0 && <span className="pill comments" title="Відкритих обговорень">💬 {f.collab.open_threads}</span>}
              </span>
              {f.collab.labels.length > 0 && (
                <span className="file-labels">
                  {f.collab.labels.map((l) => (
                    <span key={l} className={`label-chip sm ${l}`}>{LABELS[l] ?? l}</span>
                  ))}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>

      {checkedIds.length > 0 && (
        <BatchPanel ids={checkedIds} names={names} onDone={onBatchDone} onClear={() => setChecked(new Set())} />
      )}

      <div className="user-box">
        <span className="avatar" aria-hidden>{user.display_name.slice(0, 1).toUpperCase()}</span>
        <span className="user-name">
          <strong>{user.display_name}</strong>
          <span className="muted small">@{user.username}{user.is_admin && " · адмін"}</span>
        </span>
        <button className="link-btn" onClick={onLogout}>Вийти</button>
      </div>
    </aside>
  );
}
