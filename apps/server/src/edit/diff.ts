import type { MetaEntry } from "../types.js";

export interface DiffItem {
  type: "added" | "removed" | "changed";
  group: string;
  subgroup: string;
  tag: string;
  before?: unknown;
  after?: unknown;
  risk: MetaEntry["risk"];
}

/** Tags that always change on any rewrite and only add noise. */
const NOISE = new Set(["File:System:FileSize", "ExifTool:ExifTool:ExifToolVersion"]);

function keyed(entries: MetaEntry[]) {
  const m = new Map<string, MetaEntry>();
  const seen = new Map<string, number>();
  for (const e of entries) {
    const base = `${e.group}:${e.subgroup}:${e.tag}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    m.set(n ? `${base}#${n}` : base, e);
  }
  return m;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function diffEntries(before: MetaEntry[], after: MetaEntry[], opts: { includeNoise?: boolean } = {}): DiffItem[] {
  const a = keyed(before);
  const b = keyed(after);
  const out: DiffItem[] = [];
  for (const [k, e] of a) {
    if (!opts.includeNoise && NOISE.has(k.replace(/#\d+$/, ""))) continue;
    const other = b.get(k);
    if (!other) out.push({ type: "removed", group: e.group, subgroup: e.subgroup, tag: e.tag, before: e.value, risk: e.risk });
    else if (!same(e.value, other.value))
      out.push({ type: "changed", group: e.group, subgroup: e.subgroup, tag: e.tag, before: e.value, after: other.value, risk: other.risk });
  }
  for (const [k, e] of b) {
    if (!opts.includeNoise && NOISE.has(k.replace(/#\d+$/, ""))) continue;
    if (!a.has(k)) out.push({ type: "added", group: e.group, subgroup: e.subgroup, tag: e.tag, after: e.value, risk: e.risk });
  }
  return out;
}
