import { describeOp, type EditOp } from "../api";

interface Props {
  ops: EditOp[];
  busy: boolean;
  error?: string | null;
  onRemove: (index: number) => void;
  onClear: () => void;
  onPreview: () => void;
  onSaveTemplate: () => void;
}

export function PendingBar({ ops, busy, error, onRemove, onClear, onPreview, onSaveTemplate }: Props) {
  if (ops.length === 0) return null;
  return (
    <div className="pending-bar" role="region" aria-label="Незбережені зміни">
      {error && <div className="pending-error" role="alert">{error}</div>}
      <div className="pending-list">
        <strong>{ops.length} {plural(ops.length)}:</strong>
        {ops.map((op, i) => (
          <span key={i} className="op-chip" title={describeOp(op)}>
            {describeOp(op)}
            <button aria-label="Прибрати" onClick={() => onRemove(i)}>×</button>
          </span>
        ))}
      </div>
      <div className="pending-actions">
        <button className="btn" onClick={onSaveTemplate}>Зберегти як шаблон</button>
        <button className="btn" onClick={onClear}>Скасувати все</button>
        <button className="btn primary" onClick={onPreview} disabled={busy}>
          {busy ? "Перевіряємо…" : "Переглянути й зберегти"}
        </button>
      </div>
    </div>
  );
}

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "зміна";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "зміни";
  return "змін";
}
