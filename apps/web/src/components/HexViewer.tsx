import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Props {
  fileId: string;
  version: number;
  /** Bytes at or after this offset are past the format's logical end. */
  dataEnd?: number;
  /** External request to jump somewhere (e.g. "show trailing data"). */
  jumpTo?: { offset: number; nonce: number } | null;
}

const ROW = 16;
const PAGE = 512;

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const printable = (b: number) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·");

export function HexViewer({ fileId, version, dataEnd, jumpTo }: Props) {
  const [offset, setOffset] = useState(0);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [size, setSize] = useState(0);
  const [goto, setGoto] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (at: number) => {
      try {
        const aligned = Math.max(0, Math.floor(at / ROW) * ROW);
        const r = await api.hex(fileId, aligned, PAGE, version);
        const bin = atob(r.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        setBytes(arr);
        setOffset(r.offset);
        setSize(r.size);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [fileId, version],
  );

  useEffect(() => {
    load(0);
  }, [load]);

  useEffect(() => {
    if (jumpTo) load(jumpTo.offset);
  }, [jumpTo, load]);

  const rows: number[] = [];
  if (bytes) for (let i = 0; i < bytes.length; i += ROW) rows.push(i);
  const lastPage = Math.max(0, Math.floor((size - 1) / ROW) * ROW - PAGE + ROW);

  return (
    <section className="card hex-card" id="hex-viewer">
      <div className="hex-toolbar">
        <h2>Байти файлу</h2>
        <span className="muted small">
          {offset.toLocaleString("uk-UA")}–{(offset + (bytes?.length ?? 0)).toLocaleString("uk-UA")} з {size.toLocaleString("uk-UA")}
        </span>
        <div className="hex-nav">
          <button className="btn small-btn" onClick={() => load(0)} disabled={offset === 0}>Початок</button>
          <button className="btn small-btn" onClick={() => load(offset - PAGE)} disabled={offset === 0}>‹</button>
          <button className="btn small-btn" onClick={() => load(offset + PAGE)} disabled={offset + PAGE >= size}>›</button>
          <button className="btn small-btn" onClick={() => load(lastPage)} disabled={offset >= lastPage}>Кінець</button>
          {dataEnd !== undefined && dataEnd < size && (
            <button className="btn small-btn warn" onClick={() => load(dataEnd - ROW * 2)}>Дані після кінця</button>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = goto.trim().toLowerCase();
              const n = v.startsWith("0x") ? parseInt(v.slice(2), 16) : parseInt(v, 10);
              if (Number.isFinite(n)) load(n);
            }}
          >
            <input className="hex-goto" placeholder="зсув, напр. 0x1F00" value={goto} onChange={(e) => setGoto(e.target.value)} aria-label="Перейти до зсуву" />
          </form>
        </div>
      </div>
      {error && <p className="error-text small">{error}</p>}
      {dataEnd !== undefined && dataEnd < size && (
        <p className="small muted">
          <span className="hex-legend" /> червоним — байти після логічного кінця файлу (з {dataEnd.toLocaleString("uk-UA")}).
        </p>
      )}
      <div className="hex-wrap" role="table" aria-label="Шістнадцятковий вигляд">
        {rows.map((r) => {
          const abs = offset + r;
          const line = bytes!.subarray(r, r + ROW);
          return (
            <div className="hex-row" role="row" key={abs}>
              <span className="hex-off">{abs.toString(16).padStart(8, "0")}</span>
              <span className="hex-bytes">
                {Array.from(line, (b, i) => (
                  <span key={i} className={dataEnd !== undefined && abs + i >= dataEnd ? "tail" : ""}>
                    {hex2(b)}
                  </span>
                ))}
              </span>
              <span className="hex-ascii">
                {Array.from(line, (b, i) => (
                  <span key={i} className={dataEnd !== undefined && abs + i >= dataEnd ? "tail" : ""}>
                    {printable(b)}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
