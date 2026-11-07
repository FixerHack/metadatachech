import { api, formatBytes, type VersionInfo } from "../api";

interface Props {
  fileId: string;
  versions: VersionInfo[];
  current: number;
  latest: number;
  onView: (n: number) => void;
  onCompare: (a: number, b: number) => void;
  /** Omitted when the user cannot edit. */
  onRevert?: (n: number) => void;
}

export function VersionHistory({ fileId, versions, current, latest, onView, onCompare, onRevert }: Props) {
  const list = [...versions].reverse();
  return (
    <section className="card">
      <h2>Історія версій</h2>
      <ol className="versions">
        {list.map((v) => (
          <li key={v.number} className={v.number === current ? "active" : ""}>
            <div className="v-head">
              <span className="v-num">v{v.number}</span>
              {v.number === latest && <span className="pill accent">поточна</span>}
              <span className="muted small">{new Date(v.created_at).toLocaleString("uk-UA")} · {formatBytes(v.size)}</span>
            </div>
            <div className="v-note">{v.note || "—"}{v.author && <span className="muted small"> · {v.author}</span>}</div>
            <div className="v-actions">
              {v.number !== current && <button className="link-btn" onClick={() => onView(v.number)}>Переглянути</button>}
              {v.number > 1 && <button className="link-btn" onClick={() => onCompare(v.number - 1, v.number)}>Що змінилось</button>}
              {v.number !== latest && <button className="link-btn" onClick={() => onCompare(v.number, latest)}>Порівняти з поточною</button>}
              <a className="link-btn" href={api.downloadUrl(fileId, v.number)}>Скачати</a>
              {v.number !== latest && onRevert && <button className="link-btn" onClick={() => onRevert(v.number)}>Відновити</button>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
