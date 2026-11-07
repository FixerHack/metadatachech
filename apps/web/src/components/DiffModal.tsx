import { useEffect, useMemo, useState } from "react";
import { formatValue, type DiffItem } from "../api";

interface Props {
  title: string;
  diff: DiffItem[];
  warnings?: string[];
  /** When set, the modal offers to save with an optional note. */
  onConfirm?: (note: string) => void;
  confirmLabel?: string;
  busy?: boolean;
  onClose: () => void;
}

const TYPE_LABEL: Record<DiffItem["type"], string> = { added: "додано", removed: "видалено", changed: "змінено" };

export function DiffModal({ title, diff, warnings = [], onConfirm, confirmLabel = "Зберегти", busy, onClose }: Props) {
  const [note, setNote] = useState("");
  const [showComposite, setShowComposite] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Composite tags are derived; showing them doubles every change.
  const visible = useMemo(() => (showComposite ? diff : diff.filter((d) => d.group !== "Composite")), [diff, showComposite]);
  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, changed: 0 };
    for (const d of visible) c[d.type]++;
    return c;
  }, [visible]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Закрити">×</button>
        </header>

        <div className="diff-summary">
          <span className="badge added">+{counts.added} додано</span>
          <span className="badge changed">~{counts.changed} змінено</span>
          <span className="badge removed">−{counts.removed} видалено</span>
          <label className="check small">
            <input type="checkbox" checked={showComposite} onChange={(e) => setShowComposite(e.target.checked)} /> Обчислені (Composite)
          </label>
        </div>

        {warnings.length > 0 && (
          <ul className="warnings">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <div className="modal-body">
          {visible.length === 0 ? (
            <p className="muted pad">Метадані не зміняться.</p>
          ) : (
            <table className="diff">
              <tbody>
                {visible.map((d, i) => (
                  <tr key={i} className={d.type}>
                    <td className="diff-type">{TYPE_LABEL[d.type]}</td>
                    <td className="diff-tag">
                      {d.tag}
                      <div className="muted small">{d.group} › {d.subgroup}</div>
                    </td>
                    <td className="diff-vals">
                      {d.before !== undefined && <div className="old-val">{formatValue(d.before)}</div>}
                      {d.after !== undefined && <div className="new-val">{formatValue(d.after)}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="modal-foot">
          {onConfirm ? (
            <>
              <input
                className="note"
                placeholder="Коментар до версії (необовʼязково)"
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
              <button className="btn" onClick={onClose}>Назад</button>
              <button className="btn primary" disabled={busy || diff.length === 0} onClick={() => onConfirm(note)}>
                {busy ? "Зберігаємо…" : confirmLabel}
              </button>
            </>
          ) : (
            <button className="btn" onClick={onClose}>Закрити</button>
          )}
        </footer>
      </div>
    </div>
  );
}
