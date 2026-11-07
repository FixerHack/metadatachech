import { LABELS, type ActivityItem } from "../api";
import { fieldLabel, timeAgo } from "./CommentsPanel";

function describe(a: ActivityItem): string {
  const d = (a.details ?? {}) as Record<string, unknown>;
  switch (a.action) {
    case "file.upload": return "завантажив(ла) файл";
    case "file.edit": return `створив(ла) v${d.version}${d.batch ? " (масово)" : ""}`;
    case "file.revert": return `відновив(ла) v${d.to} як v${d.version}`;
    case "file.download": return `скачав(ла) v${d.version}`;
    case "file.reanalyze": return "перезапустив(ла) аналіз";
    case "comment.create": return d.fieldPath ? `прокоментував(ла) поле ${fieldLabel(String(d.fieldPath))}` : "додав(ла) коментар";
    case "comment.reply": return "відповів(ла) в обговоренні";
    case "comment.edit": return "змінив(ла) коментар";
    case "comment.delete": return "видалив(ла) коментар";
    case "thread.resolve": return "закрив(ла) обговорення";
    case "thread.reopen": return "знову відкрив(ла) обговорення";
    case "label.add": return `поставив(ла) мітку «${LABELS[String(d.label)] ?? d.label}»`;
    case "label.remove": return `зняв(ла) мітку «${LABELS[String(d.label)] ?? d.label}»`;
    default: return a.action;
  }
}

export function ActivityLog({ items }: { items: ActivityItem[] }) {
  return (
    <section className="card">
      <h2>Журнал дій</h2>
      {items.length === 0 ? (
        <p className="muted small">Поки порожньо.</p>
      ) : (
        <ol className="activity">
          {items.map((a) => (
            <li key={a.id}>
              <strong>{a.user_name ?? "Система"}</strong> {describe(a)}
              <span className="muted small" title={new Date(a.created_at).toLocaleString("uk-UA")}> · {timeAgo(a.created_at)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
