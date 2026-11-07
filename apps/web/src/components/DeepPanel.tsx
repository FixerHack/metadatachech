import { formatBytes, type DeepReport } from "../api";

interface Props {
  deep: DeepReport;
  onShowBytes: (offset: number) => void;
}

const fmtDuration = (s?: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  const m = Math.floor(n / 60);
  return `${m}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
};

const ACTIVE_PDF = new Set(["JS", "JavaScript", "AA", "OpenAction", "Launch", "RichMedia", "XFA", "SubmitForm", "ImportData", "GoToE", "GoToR"]);

/** Format-specific findings: previews, media streams, Office review data, PDF scan, container structure. */
export function DeepPanel({ deep, onShowBytes }: Props) {
  const { previews, mainImage, media, office, pdf, trailer } = deep;
  const any = previews?.length || media || office || pdf || trailer?.trailingBytes || trailer?.leadingBytes;
  if (!any) return null;

  return (
    <div className="deep">
      {previews && previews.length > 0 && (
        <section className="card">
          <h2>Вбудовані зображення</h2>
          <p className="muted small">
            Камери й редактори зберігають у файлі зменшені копії. Якщо фото обрізали чи ретушували, превʼю часто лишається від оригіналу.
          </p>
          <div className="previews">
            {mainImage && (
              <figure>
                <img src={mainImage.thumbUrl} alt="Основне зображення" loading="lazy" />
                <figcaption>
                  <strong>Основне</strong>
                  <span className="muted small">{mainImage.width}×{mainImage.height}</span>
                </figcaption>
              </figure>
            )}
            {previews.map((p) => (
              <figure key={p.tag} className={p.differs ? "differs" : p.cropped ? "cropped" : ""}>
                {p.mime && /^image\/(jpeg|png|webp|gif)$/.test(p.mime) ? (
                  <img src={p.url} alt={p.tag} loading="lazy" />
                ) : (
                  <div className="preview-na">{p.mime ?? "двійкові дані"}</div>
                )}
                <figcaption>
                  <strong>{p.tag}</strong>
                  <span className="muted small">
                    {p.width && p.height ? `${p.width}×${p.height} · ` : ""}{formatBytes(p.size)}
                  </span>
                  {p.differs && <span className="pill high">Інше зображення ({p.distance}/64)</span>}
                  {!p.differs && p.cropped && <span className="pill medium">Інші пропорції — обрізано?</span>}
                  {!p.differs && !p.cropped && p.distance !== undefined && <span className="pill ok">Збігається</span>}
                  <a className="link-btn" href={p.url} download>Скачати</a>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {media && (
        <section className="card">
          <h2>Медіапотоки</h2>
          <p className="small">
            <strong>{media.formatLong ?? media.format}</strong>
            {media.duration && <> · {fmtDuration(media.duration)}</>}
            {media.bitRate && <> · {Math.round(Number(media.bitRate) / 1000)} кбіт/с</>}
            {media.chapters > 0 && <> · розділів: {media.chapters}</>}
          </p>
          <table className="streams">
            <thead>
              <tr>
                <th>#</th>
                <th>Тип</th>
                <th>Кодек</th>
                <th>Параметри</th>
                <th>Теги</th>
              </tr>
            </thead>
            <tbody>
              {media.streams.map((s) => (
                <tr key={s.index}>
                  <td>{s.index}</td>
                  <td>{{ video: "Відео", audio: "Аудіо", subtitle: "Субтитри", data: "Дані", cover: "Обкладинка", attachment: "Вкладення" }[s.type] ?? s.type}</td>
                  <td>
                    {s.codec}
                    {s.profile && <span className="muted"> · {s.profile}</span>}
                  </td>
                  <td className="small">
                    {[
                      s.width && s.height ? `${s.width}×${s.height}` : null,
                      s.fps && s.fps !== "0/0" ? `${s.fps} к/с` : null,
                      s.sampleRate ? `${s.sampleRate} Гц` : null,
                      s.channelLayout ?? (s.channels ? `${s.channels} кан.` : null),
                      s.language,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                  <td className="small muted">{Object.entries(s.tags).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {office && (
        <section className="card">
          <h2>Документ {office.kind.toUpperCase()}: приховане</h2>
          {office.macros && <p className="banner error small">Містить макроси — виконуваний код.</p>}
          {office.people.length > 0 && (
            <div className="deep-block">
              <h3>Люди в документі</h3>
              <div className="chips">
                {office.people.map((p) => (
                  <span key={p} className="chip static">{p}</span>
                ))}
              </div>
            </div>
          )}
          {office.revisions.length > 0 && (
            <div className="deep-block">
              <h3>Виправлення в режимі рецензування ({office.revisions.length})</h3>
              <ul className="revisions">
                {office.revisions.slice(0, 50).map((r, i) => (
                  <li key={i} className={r.type}>
                    <span className="rev-type">{r.type === "insert" ? "+ додано" : r.type === "delete" ? "− видалено" : "~ змінено"}</span>
                    <span className="rev-text">{r.text}</span>
                    <span className="muted small">{r.author}{r.date ? ` · ${new Date(r.date).toLocaleString("uk-UA")}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {office.comments.length > 0 && (
            <div className="deep-block">
              <h3>Коментарі рецензентів ({office.comments.length})</h3>
              <ul className="doc-comments">
                {office.comments.slice(0, 50).map((c, i) => (
                  <li key={i}>
                    <span className="small"><strong>{c.author ?? "?"}</strong>{c.where && <span className="muted"> · {c.where}</span>}{c.date && <span className="muted"> · {new Date(c.date).toLocaleString("uk-UA")}</span>}</span>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {office.hiddenSheets.length > 0 && (
            <div className="deep-block">
              <h3>Приховані аркуші</h3>
              <p>{office.hiddenSheets.join(", ")}</p>
            </div>
          )}
          {office.notes.length > 0 && (
            <div className="deep-block">
              <h3>Нотатки доповідача</h3>
              <ul className="plain">{office.notes.slice(0, 20).map((n, i) => <li key={i}>{n}</li>)}</ul>
            </div>
          )}
          {office.externalTargets.length > 0 && (
            <div className="deep-block">
              <h3>Зовнішні посилання</h3>
              <ul className="plain mono">{office.externalTargets.slice(0, 30).map((t, i) => <li key={i}><span className="muted">{t.type}:</span> {t.target}</li>)}</ul>
            </div>
          )}
          {office.embedded.length > 0 && (
            <div className="deep-block">
              <h3>Вкладені файли ({office.embedded.length})</h3>
              <ul className="plain">
                {office.embedded.slice(0, 30).map((e) => (
                  <li key={e.name}>
                    <span className="mono">{e.name}</span> <span className="muted small">{formatBytes(e.size)}</span>
                    {e.gps && <span className="pill high">GPS {e.gps.lat.toFixed(4)}, {e.gps.lon.toFixed(4)}</span>}
                    {e.device && <span className="muted small"> · {e.device}</span>}
                    {e.author && <span className="muted small"> · {e.author}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {office.truncated && <p className="muted small">Частину архіву пропущено через ліміти розміру.</p>}
        </section>
      )}

      {pdf && (
        <section className="card">
          <h2>PDF: структура й активний вміст</h2>
          <p className="small">
            Версія {pdf.version ?? "?"} · інкрементних оновлень: <strong>{pdf.incrementalUpdates}</strong> · розпаковано потоків: {pdf.streamsScanned}
            {pdf.streamsSkipped > 0 && <> (пропущено {pdf.streamsSkipped})</>}
          </p>
          <div className="chips">
            {Object.entries(pdf.features).map(([k, v]) => (
              <span key={k} className={`chip static ${ACTIVE_PDF.has(k) ? "danger" : k === "EmbeddedFile" ? "warn" : ""}`}>
                /{k} <span>{v}</span>
              </span>
            ))}
            {pdf.obfuscatedNames > 0 && <span className="chip static danger">замасковані імена <span>{pdf.obfuscatedNames}</span></span>}
          </div>
          {pdf.embeddedFiles.length > 0 && (
            <div className="deep-block">
              <h3>Вкладення</h3>
              <ul className="plain mono">{pdf.embeddedFiles.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
          {pdf.uris.length > 0 && (
            <div className="deep-block">
              <h3>Посилання ({pdf.uris.length})</h3>
              <ul className="plain mono">{pdf.uris.slice(0, 30).map((u) => <li key={u}>{u}</li>)}</ul>
            </div>
          )}
        </section>
      )}

      {trailer && (trailer.trailingBytes > 0 || trailer.leadingBytes) && (
        <section className="card warn-card">
          <h2>Сторонні дані в контейнері</h2>
          <p>
            {trailer.format} закінчується на байті <strong>{trailer.dataEnd.toLocaleString("uk-UA")}</strong>, а файл має{" "}
            {trailer.size.toLocaleString("uk-UA")} байтів.
            {trailer.trailingBytes > 0 && <> Після кінця — ще <strong>{trailer.trailingBytes.toLocaleString("uk-UA")}</strong> байтів</>}
            {trailer.trailingType && <> ({trailer.trailingType})</>}.
            {trailer.leadingBytes ? <> Перед архівом — {trailer.leadingBytes.toLocaleString("uk-UA")} байтів.</> : null}
          </p>
          {trailer.trailingBytes > 0 && (
            <button className="btn" onClick={() => onShowBytes(trailer.dataEnd)}>Показати в байтах</button>
          )}
        </section>
      )}
    </div>
  );
}
