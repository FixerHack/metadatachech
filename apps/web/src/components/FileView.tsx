import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, can, formatBytes, LABELS, ROLE_LABELS, upsertOp, type ActivityItem, type DiffItem, type EditOp, type FileDetail, type Project, type Thread, type User } from "../api";
import { useAppEvent } from "../events";
import { CommentsPanel } from "./CommentsPanel";
import { ActivityLog } from "./ActivityLog";
import { DeepPanel } from "./DeepPanel";
import { HexViewer } from "./HexViewer";
import { MetadataTable } from "./MetadataTable";
import { GpsMap } from "./GpsMap";
import { EditTools } from "./EditTools";
import { PendingBar } from "./PendingBar";
import { DiffModal } from "./DiffModal";
import { VersionHistory } from "./VersionHistory";

interface Props {
  id: string;
  user: User;
  projects: Project[];
  onDelete: (id: string) => void;
  onChanged: () => void;
}

type Modal =
  | { kind: "preview"; diff: DiffItem[]; warnings: string[] }
  | { kind: "compare"; a: number; b: number; diff: DiffItem[] };

export function FileView({ id, user, projects, onDelete, onChanged }: Props) {
  const [data, setData] = useState<FileDetail | null>(null);
  const [viewVersion, setViewVersion] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EditOp[]>([]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [templatesVersion, setTemplatesVersion] = useState(0);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [focusField, setFocusField] = useState<string | null>(null);
  /** Someone else saved a new version while this view had unsaved edits. */
  const [staleBy, setStaleBy] = useState(false);
  const [showHex, setShowHex] = useState(false);
  const [hexJump, setHexJump] = useState<{ offset: number; nonce: number } | null>(null);
  const showBytes = (offset: number) => {
    setShowHex(true);
    setHexJump({ offset: Math.max(0, offset - 32), nonce: Date.now() });
    setTimeout(() => document.getElementById("hex-viewer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const loadCollab = useCallback(() => {
    api.comments(id).then(setThreads, () => undefined);
    api.activity(id).then(setActivity, () => undefined);
  }, [id]);

  useEffect(() => {
    loadCollab();
    api.users().then(setUsers, () => undefined);
    api.markMentionsRead(id).catch(() => undefined);
  }, [id, loadCollab]);

  const load = useCallback(
    (version?: number) => api.get(id, version).then(setData, (e) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load(viewVersion);
  }, [load, viewVersion]);

  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useAppEvent((e) => {
    if (!("fileId" in e) || e.fileId !== id) return;
    if (e.type === "comment") {
      loadCollab();
      if (e.by !== user.id) api.markMentionsRead(id).catch(() => undefined);
    }
    if (e.type === "label") {
      load(viewVersion);
      loadCollab();
    }
    if (e.type === "file" && e.by !== user.id) {
      loadCollab();
      // Keep unsaved edits intact; offer a reload instead of replacing the table.
      if (pendingRef.current.length) setStaleBy(true);
      else load(viewVersion);
    }
  });

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!pending.length) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [pending.length]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fieldThreads = useMemo(() => {
    const m = new Map<string, { open: number; total: number }>();
    for (const t of threads) {
      if (!t.field_path || (t.deleted && !t.replies.some((r) => !r.deleted))) continue;
      const c = m.get(t.field_path) ?? { open: 0, total: 0 };
      c.total++;
      if (t.status === "open") c.open++;
      m.set(t.field_path, c);
    }
    return m;
  }, [threads]);

  if (!data) return error ? <div className="banner error">{error}</div> : <div className="muted pad">Завантаження…</div>;

  const { file, version, report, entries } = data;
  const latest = data.versions[data.versions.length - 1]?.number ?? version.number;
  const canEdit = can(data.role, "editor");
  const canComment = can(data.role, "commenter");
  const editable = data.isLatest && data.canWrite && canEdit;
  const moveTargets = projects.filter((p) => p.id !== data.project.id && can(p.role, "editor"));
  const move = (projectId: string) => {
    const target = projects.find((p) => p.id === projectId);
    if (!target || !confirm(`Перенести «${file.original_name}» у проєкт «${target.name}»? Доступ до файлу зміниться відповідно до учасників того проєкту.`)) return;
    run(async () => {
      setData(await api.moveFile(id, projectId));
      setNotice({ text: `Файл перенесено в «${target.name}».`, warnings: [] });
      onChanged();
    });
  };

  const addOp = (op: EditOp) => setPending((p) => upsertOp(p, op));
  const addOps = (ops: EditOp[]) => setPending((p) => ops.reduce(upsertOp, p));
  const undoTag = (tag: string) =>
    setPending((p) => p.filter((o) => !((o.kind === "set" || o.kind === "delete") && o.tag.toLowerCase() === tag.toLowerCase())));

  const preview = () =>
    run(async () => {
      const r = await api.preview(id, pending);
      setModal({ kind: "preview", diff: r.diff, warnings: r.warnings });
    });

  const save = (note: string) =>
    run(async () => {
      const r = await api.edit(id, pending, note);
      setModal(null);
      setPending([]);
      setData(r.detail);
      setViewVersion(undefined);
      setStaleBy(false);
      loadCollab();
      setNotice({
        text: r.created ? `Збережено як v${r.version}: ${r.diff.filter((d) => d.group !== "Composite").length} змін у метаданих.` : "Змін немає, нову версію не створено.",
        warnings: r.warnings,
      });
      onChanged();
    });

  const compare = (a: number, b: number) =>
    run(async () => {
      setModal({ kind: "compare", a, b, diff: await api.diff(id, a, b) });
    });

  const revert = (n: number) => {
    if (!confirm(`Відновити v${n}? Буде створено нову версію v${latest + 1} — історія не зітреться.`)) return;
    run(async () => {
      const r = await api.revert(id, n);
      setData(r.detail);
      setViewVersion(undefined);
      setPending([]);
      setNotice({ text: `Відновлено v${n} як v${r.version}.`, warnings: [] });
      loadCollab();
      onChanged();
    });
  };

  const saveTemplate = () => {
    const name = prompt("Назва шаблону:");
    if (!name?.trim()) return;
    run(async () => {
      await api.saveTemplate(name.trim(), pending);
      setTemplatesVersion((v) => v + 1);
      setNotice({ text: `Шаблон «${name.trim()}» збережено.`, warnings: [] });
    });
  };

  const reanalyze = () =>
    run(async () => {
      setData(await api.reanalyze(id));
      setViewVersion(undefined);
      onChanged();
    });

  const activeLabels = new Set(data.labels.map((l) => l.label));
  const toggleLabel = (label: string) =>
    run(async () => {
      const labels = await api.setLabel(id, label, !activeLabels.has(label));
      setData((d) => (d ? { ...d, labels } : d));
      onChanged();
    });

  const facts: [string, string | undefined][] = report
    ? [
        ["Пристрій", report.device],
        ["Обʼєктив", report.lens],
        ["Програма", report.software],
        ["Автор", report.author],
        ["Створено", report.created],
        ["Змінено", report.modified],
        ["Розмір", report.dimensions],
        ["Тривалість", report.duration],
      ]
    : [];

  return (
    <div className={`file-view ${pending.length ? "has-pending" : ""}`}>
      <header className="file-header">
        <div>
          <h1 className="title">{file.original_name}</h1>
          <p className="muted small">
            <span className="project-tag">▣ {data.project.name}</span>{" "}
            <span className={`role-pill ${data.role}`}>{ROLE_LABELS[data.role]}</span> ·{" "}
            {file.detected_mime ?? file.declared_mime ?? "невідомий тип"} · {formatBytes(version.size)} · версія {version.number}
            {data.exiftoolVersion && <> · ExifTool {data.exiftoolVersion}</>}
          </p>
          <div className="labels-row" role="group" aria-label="Мітки файлу">
            {Object.entries(LABELS).map(([key, label]) => {
              const on = activeLabels.has(key);
              const meta = data.labels.find((l) => l.label === key);
              return (
                <button
                  key={key}
                  className={`label-chip ${key} ${on ? "on" : ""}`}
                  aria-pressed={on}
                  title={meta ? `${meta.user_name}, ${new Date(meta.created_at).toLocaleString("uk-UA")}` : "Поставити мітку"}
                  onClick={() => toggleLabel(key)}
                  disabled={busy || !canComment}
                >
                  {on ? "✓ " : ""}{label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="actions">
          <a className="btn" href={api.downloadUrl(id, version.number)}>Завантажити</a>
          <a className="btn" href={api.exportUrl(id)}>Експорт JSON</a>
          {canEdit && moveTargets.length > 0 && (
            <select className="btn" value="" onChange={(e) => e.target.value && move(e.target.value)} aria-label="Перенести в проєкт">
              <option value="">Перенести…</option>
              {moveTargets.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          {canEdit && <button className="btn" onClick={reanalyze} disabled={busy}>Переаналізувати</button>}
          {canEdit && <button
            className="btn danger"
            onClick={() => {
              if (confirm(`Видалити «${file.original_name}» і всі його версії?`)) onDelete(id);
            }}
          >
            Видалити
          </button>}
        </div>
      </header>

      {error && (
        <div className="banner error" role="alert">
          {error}
          <button className="link" onClick={() => setError(null)}>Закрити</button>
        </div>
      )}
      {notice && (
        <div className="banner ok" role="status">
          <div>
            {notice.text}
            {notice.warnings.length > 0 && (
              <ul className="notice-warnings">
                {notice.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          <button className="link" onClick={() => setNotice(null)}>Закрити</button>
        </div>
      )}
      {staleBy && (
        <div className="banner info">
          Хтось інший щойно зберіг нову версію файлу.
          <button
            className="link"
            onClick={() => {
              setStaleBy(false);
              setPending([]);
              setViewVersion(undefined);
              load();
            }}
          >
            Оновити (незбережені зміни буде скинуто)
          </button>
        </div>
      )}
      {!data.isLatest && (
        <div className="banner info">
          Ти переглядаєш v{version.number} (лише читання).
          <button className="link" onClick={() => setViewVersion(undefined)}>До поточної v{latest}</button>
          {canEdit && <button className="link" onClick={() => revert(version.number)}>Відновити цю версію</button>}
        </div>
      )}
      {data.isLatest && data.canWrite && !canEdit && (
        <div className="banner info">Твоя роль у проєкті — «{ROLE_LABELS[data.role]}»: метадані можна переглядати, але не змінювати.</div>
      )}
      {data.isLatest && !data.canWrite && (
        <div className="banner info">ExifTool не вміє записувати цей формат, тому доступний лише перегляд.</div>
      )}

      {report && (
        <>
          <section className="stats">
            <Stat label="Усього тегів" value={report.counts.total} />
            <Stat label="Високий ризик" value={report.counts.high} tone="high" />
            <Stat label="Середній ризик" value={report.counts.medium} tone="medium" />
            <Stat label="Груп" value={Object.keys(report.counts.groups).length} />
          </section>

          {report.anomalies.length > 0 && (
            <section className="card">
              <h2>Знахідки</h2>
              <ul className="anomalies">
                {report.anomalies.map((a) => (
                  <li key={a.code + a.message} className={a.level}>
                    <span className="dot" aria-hidden />
                    {a.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className={`grid-2 ${report.gps ? "" : "single"}`}>
            <section className="card">
              <h2>Коротко</h2>
              <dl className="facts">
                {facts
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                {facts.every(([, v]) => !v) && <p className="muted small">Ключових полів не знайдено.</p>}
              </dl>
              <h3>Хеші</h3>
              <dl className="facts mono">
                {(["md5", "sha1", "sha256"] as const).map((h) => (
                  <div key={h}>
                    <dt>{h.toUpperCase()}</dt>
                    <dd className="hash" title="Натисни, щоб скопіювати" onClick={() => navigator.clipboard.writeText(version[h])}>
                      {version[h]}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
            {report.gps && (
              <section className="card">
                <h2>Геолокація</h2>
                <GpsMap lat={report.gps.lat} lon={report.gps.lon} />
                <p className="small mono">
                  {report.gps.lat.toFixed(6)}, {report.gps.lon.toFixed(6)}
                  {report.gps.alt !== undefined && <> · {report.gps.alt} м</>} ·{" "}
                  <a href={`https://www.openstreetmap.org/?mlat=${report.gps.lat}&mlon=${report.gps.lon}#map=16/${report.gps.lat}/${report.gps.lon}`} target="_blank" rel="noreferrer">
                    OSM
                  </a>
                </p>
              </section>
            )}
          </div>
        </>
      )}

      {data.deep && <DeepPanel deep={data.deep} onShowBytes={showBytes} />}

      {showHex ? (
        <HexViewer fileId={id} version={version.number} dataEnd={data.deep?.trailer?.dataEnd} jumpTo={hexJump} />
      ) : (
        <button className="btn hex-open" onClick={() => setShowHex(true)}>Показати байти файлу (hex)</button>
      )}

      <div className={`grid-2 ${editable ? "" : "single"}`}>
        {editable && (
          <EditTools key={version.number} gps={report?.gps} onOp={addOp} onOps={addOps} templatesVersion={templatesVersion} />
        )}
        <VersionHistory
          fileId={id}
          versions={data.versions}
          current={version.number}
          latest={latest}
          onView={(n) => setViewVersion(n === latest ? undefined : n)}
          onCompare={compare}
          onRevert={canEdit ? revert : undefined}
        />
      </div>

      <div className="grid-2">
        <CommentsPanel
          fileId={id}
          role={data.role}
          version={version.number}
          me={user}
          users={users}
          threads={threads}
          focusField={focusField}
          onFocusField={setFocusField}
          onChanged={loadCollab}
        />
        <ActivityLog items={activity} />
      </div>

      <MetadataTable
        entries={entries}
        editable={editable}
        pending={pending}
        onOp={addOp}
        onUndo={undoTag}
        fieldThreads={fieldThreads}
        onComment={setFocusField}
        canComment={canComment}
      />

      <PendingBar
        ops={pending}
        busy={busy}
        error={error}
        onRemove={(i) => setPending((p) => p.filter((_, j) => j !== i))}
        onClear={() => setPending([])}
        onPreview={preview}
        onSaveTemplate={saveTemplate}
      />

      {modal?.kind === "preview" && (
        <DiffModal
          title={`Попередній перегляд: v${latest} → v${latest + 1}`}
          diff={modal.diff}
          warnings={modal.warnings}
          busy={busy}
          confirmLabel={`Зберегти як v${latest + 1}`}
          onConfirm={save}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "compare" && (
        <DiffModal title={`Порівняння v${modal.a} → v${modal.b}`} diff={modal.diff} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "high" | "medium" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
