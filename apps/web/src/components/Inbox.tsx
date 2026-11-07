import { useCallback, useEffect, useState } from "react";
import { api, type Mention } from "../api";
import { useAppEvent } from "../events";

/** Bell with unread @mentions; clicking one opens the file. */
export function Inbox({ onOpen }: { onOpen: (fileId: string) => void }) {
  const [items, setItems] = useState<Mention[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => api.mentions().then(setItems, () => undefined), []);
  useEffect(() => {
    load();
  }, [load]);
  useAppEvent((e) => {
    if (e.type === "mention" || e.type === "comment") load();
  });

  const unread = items.filter((m) => !m.read_at).length;

  return (
    <div className="inbox">
      <button className={`icon-btn bell ${unread ? "has" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={`Згадки: ${unread} нових`} title="Згадки">
        @{unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="inbox-pop" role="dialog" aria-label="Згадки">
          <div className="inbox-head">
            <strong>Тебе згадали</strong>
            {unread > 0 && (
              <button className="link-btn" onClick={() => api.markMentionsRead().then(load)}>Прочитати всі</button>
            )}
          </div>
          {items.length === 0 && <p className="muted small">Поки ніхто не згадував.</p>}
          {items.map((m) => (
            <button
              key={m.comment_id}
              className={`inbox-item ${m.read_at ? "" : "unread"}`}
              onClick={() => {
                setOpen(false);
                onOpen(m.file_id);
              }}
            >
              <span className="small"><strong>{m.author_name}</strong> у «{m.file_name}»</span>
              <span className="inbox-body">{m.body}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
