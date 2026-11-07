import { useEffect, useState } from "react";
import { api, type EditOp, type Preset, type Template } from "../api";
import { GpsMap } from "./GpsMap";

interface Props {
  gps?: { lat: number; lon: number };
  onOp: (op: EditOp) => void;
  onOps: (ops: EditOp[]) => void;
  templatesVersion: number;
}

const SHIFT_RE = /^[+-]\d{1,4}(:\d{1,4}){0,2}( \d{1,4}(:\d{1,4}){0,2})?$/;

export function EditTools({ gps, onOp, onOps, templatesVersion }: Props) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [shift, setShift] = useState("+1:00");
  const [lat, setLat] = useState(gps ? String(gps.lat) : "");
  const [lon, setLon] = useState(gps ? String(gps.lon) : "");
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    api.presets().then(setPresets, () => undefined);
  }, []);
  useEffect(() => {
    api.templates().then(setTemplates, () => undefined);
  }, [templatesVersion]);

  const latN = Number(lat), lonN = Number(lon);
  const gpsValid = lat !== "" && lon !== "" && Math.abs(latN) <= 90 && Math.abs(lonN) <= 180;
  const shiftValid = SHIFT_RE.test(shift.trim());

  const removeTemplate = async (t: Template) => {
    if (!confirm(`Видалити шаблон «${t.name}»?`)) return;
    await api.deleteTemplate(t.id);
    setTemplates((ts) => ts.filter((x) => x.id !== t.id));
  };

  return (
    <section className="card tools">
      <h2>Редагування</h2>

      <div className="tool-block">
        <h3>Очищення</h3>
        <div className="preset-grid">
          {presets.map((p) => (
            <button key={p.id} className="preset" onClick={() => onOp({ kind: "preset", preset: p.id })}>
              <strong>{p.label}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tool-row">
        <div className="tool-block">
          <h3>Зсув усіх дат</h3>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (shiftValid) onOp({ kind: "shiftDates", by: shift.trim() });
            }}
          >
            <input value={shift} onChange={(e) => setShift(e.target.value)} aria-label="Зсув" className={shiftValid ? "" : "invalid"} />
            <button className="btn" disabled={!shiftValid}>Додати</button>
          </form>
          <p className="muted small">
            Формат: <code>+1:30</code> (год:хв), <code>-0:0:1 0:0:0</code> (Р:М:Д год:хв:с).
          </p>
        </div>

        <div className="tool-block">
          <h3>Геолокація</h3>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (gpsValid) onOp({ kind: "setGps", lat: latN, lon: lonN });
            }}
          >
            <input placeholder="Широта" value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
            <input placeholder="Довгота" value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
            <button className="btn" disabled={!gpsValid}>Встановити</button>
          </form>
          <button className="link-btn" onClick={() => setShowMap((s) => !s)}>
            {showMap ? "Сховати карту" : "Обрати на карті"}
          </button>
          {showMap && (
            <GpsMap
              lat={gpsValid ? latN : 50.45}
              lon={gpsValid ? lonN : 30.52}
              zoom={gpsValid ? 13 : 5}
              noMarker={!gpsValid}
              onPick={(a, b) => {
                setLat(a.toFixed(6));
                setLon(b.toFixed(6));
              }}
            />
          )}
        </div>
      </div>

      <div className="tool-block">
        <h3>Шаблони</h3>
        {templates.length === 0 ? (
          <p className="muted small">Збережи набір змін як шаблон кнопкою «Зберегти як шаблон» у панелі змін.</p>
        ) : (
          <ul className="templates">
            {templates.map((t) => (
              <li key={t.id}>
                <span title={t.ops.length + " змін"}>{t.name}</span>
                <span className="muted small">{t.ops.length} змін</span>
                <button className="btn small-btn" onClick={() => onOps(t.ops)}>Застосувати</button>
                <button className="icon-btn danger" title="Видалити шаблон" onClick={() => removeTemplate(t)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
