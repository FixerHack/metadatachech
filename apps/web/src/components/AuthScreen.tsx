import { useState } from "react";
import { api, type User } from "../api";

interface Props {
  firstRun: boolean;
  onAuthed: (u: User) => void;
}

export function AuthScreen({ firstRun, onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">(firstRun ? "register" : "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === "login" ? await api.login(username, password) : await api.register(username, password, displayName);
      onAuthed(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth card" onSubmit={submit}>
        <div className="brand static">
          <span className="brand-mark">M</span> MetaCheck
        </div>
        <h1>{mode === "login" ? "Вхід" : firstRun ? "Створи перший обліковий запис" : "Реєстрація"}</h1>
        {firstRun && mode === "register" && (
          <p className="muted small">Перший користувач стає адміністратором і може видаляти будь-які коментарі.</p>
        )}
        <label>
          Логін
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        {mode === "register" && (
          <label>
            Імʼя, яке бачать інші
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="напр. Олена Коваль" />
          </label>
        )}
        <label>
          Пароль
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={mode === "register" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error-text small" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Увійти" : "Зареєструватися"}
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "Немає облікового запису? Зареєструватися" : "Вже є обліковий запис? Увійти"}
        </button>
      </form>
    </div>
  );
}
