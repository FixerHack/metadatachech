import { useEffect, useState } from "react";
import { api, type BatchResult, type EditOp, type Preset, type Template } from "../api";

interface Props {
  ids: string[];
  names: Map<string, string>;
  onDone: () => void;
  onClear: () => void;
}

export function BatchPanel({ ids, names, onDone, onClear }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [choice, setChoice] = useState("preset:personal");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<BatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.presets().then(setPresets, () => undefined);
    api.templates().then(setTemplates, () => undefined);
  }, []);

  const opsFor = (): { ops: EditOp[]; label: string } | null => {
    const [kind, key] = choice.split(":");
    if (kind === "preset") {
      const p = presets.find((x) => x.id === key);
      return p ? { ops: [{ kind: "preset", preset: p.id }], label: p.label } : null;
    }
    const t = templates.find((x) => x.id === key);
    return t ? { ops: t.ops, label: `шаблон «${t.name}»` } : null;
  };

  const apply = async () => {
    const sel = opsFor();
    if (!sel) return;
    if (!confirm(`Застосувати «${sel.label}» до ${ids.length} файлів? Для кожного буде створено нову версію.`)) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const r = await api.batch(ids, sel.ops, `Масово: ${sel.label}`);
      setResults(r.results);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ok = results?.filter((r) => r.ok && r.created).length ?? 0;
  const same = results?.filter((r) => r.ok && !r.created).length ?? 0;
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="batch">
      <div className="batch-head">
        <strong>Вибрано: {ids.length}</strong>
        <button className="link-btn" onClick={onClear}>Зняти вибір</button>
      </div>
      <select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Дія">
        <optgroup label="Очищення">
          {presets.map((p) => (
            <option key={p.id} value={`preset:${p.id}`}>{p.label}</option>
          ))}
        </optgroup>
        {templates.length > 0 && (
          <optgroup label="Шаблони">
            {templates.map((t) => (
              <option key={t.id} value={`template:${t.id}`}>{t.name}</option>
            ))}
          </optgroup>
        )}
      </select>
      <button className="btn primary" disabled={busy || !opsFor()} onClick={apply}>
        {busy ? "Обробляємо…" : `Застосувати до ${ids.length}`}
      </button>
      {error && <p className="small error-text">{error}</p>}
      {results && (
        <div className="small">
          <p>
            Нових версій: {ok}
            {same > 0 && <>, без змін: {same}</>}
            {failed.length > 0 && <>, помилок: {failed.length}</>}
          </p>
          {failed.map((f) => (
            <p key={f.id} className="error-text">{names.get(f.id) ?? f.id}: {f.error}</p>
          ))}
        </div>
      )}
    </div>
  );
}
