import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import type { User } from "../api";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  users: User[];
  placeholder?: string;
  autoFocus?: boolean;
  rows?: number;
}

export interface MentionInputHandle {
  focus: () => void;
}

/** Textarea with @username autocomplete. Ctrl/Cmd+Enter submits. */
export const MentionInput = forwardRef<MentionInputHandle, Props>(function MentionInput(
  { value, onChange, onSubmit, users, placeholder, autoFocus, rows = 3 },
  ref,
) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  useImperativeHandle(ref, () => ({ focus: () => ta.current?.focus() }));

  const matches =
    query === null
      ? []
      : users
          .filter((u) => u.username.toLowerCase().startsWith(query) || u.display_name.toLowerCase().includes(query))
          .slice(0, 6);

  const detect = (text: string, caret: number) => {
    const m = text.slice(0, caret).match(/(?:^|[^\w@])@([\w.-]{0,32})$/);
    setQuery(m ? m[1].toLowerCase() : null);
    setActive(0);
  };

  const insert = (u: User) => {
    const el = ta.current;
    if (!el) return;
    const caret = el.selectionStart;
    const before = value.slice(0, caret).replace(/@([\w.-]{0,32})$/, `@${u.username} `);
    const next = before + value.slice(caret);
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  };

  return (
    <div className="mention-input">
      <textarea
        ref={ta}
        rows={rows}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target.value, e.target.selectionStart);
        }}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(matches[active]); return; }
            if (e.key === "Escape") { setQuery(null); return; }
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
      />
      {matches.length > 0 && (
        <ul className="mention-pop" role="listbox">
          {matches.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                className={i === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(u);
                }}
              >
                <strong>{u.display_name}</strong> <span className="muted">@{u.username}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
});
