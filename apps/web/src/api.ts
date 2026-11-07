export type Risk = "high" | "medium" | "low";

export interface MetaEntry {
  group: string;
  subgroup: string;
  tag: string;
  value: unknown;
  raw?: unknown;
  binary?: boolean;
  writable?: boolean;
  risk: Risk;
  riskReason?: string;
}

export interface Anomaly {
  level: "warning" | "info";
  code: string;
  message: string;
}

export interface Report {
  counts: { total: number; high: number; medium: number; low: number; groups: Record<string, number> };
  gps?: { lat: number; lon: number; alt?: number };
  device?: string;
  lens?: string;
  software?: string;
  author?: string;
  created?: string;
  modified?: string;
  dimensions?: string;
  duration?: string;
  anomalies: Anomaly[];
  warnings: string[];
}

export interface FileListItem {
  id: string;
  original_name: string;
  detected_mime: string | null;
  created_at: string;
  size: number;
  version: number;
  project_id: string;
  project_name: string;
  counts: Report["counts"] | null;
  collab: { open_threads: number; comments: number; labels: string[] };
}

export type Role = "viewer" | "commenter" | "editor" | "owner";
const ROLE_RANK: Record<Role, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Глядач",
  commenter: "Коментатор",
  editor: "Редактор",
  owner: "Власник",
};
export const ROLE_HINTS: Record<Role, string> = {
  viewer: "бачить файли, метадані, коментарі; скачує",
  commenter: "+ коментує, закриває обговорення, ставить мітки",
  editor: "+ завантажує, редагує метадані, відкочує, видаляє файли",
  owner: "+ керує учасниками, перейменовує й видаляє проєкт",
};
export function can(role: Role | null | undefined, min: Role) {
  return !!role && ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  file_count: number;
  member_count: number;
  role: Role;
}

export interface Member {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
  role: Role;
  added_at: string;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
}

export interface CommentView {
  id: string;
  parent_id: string | null;
  version_number: number | null;
  field_path: string | null;
  author: { id: string; name: string; username: string };
  body: string;
  deleted: boolean;
  edited: boolean;
  created_at: string;
  updated_at: string | null;
}

export interface Thread extends CommentView {
  status: "open" | "resolved";
  resolved_by: string | null;
  resolved_at: string | null;
  replies: CommentView[];
}

export interface FileLabel {
  label: string;
  created_at: string;
  user_name: string;
}

export interface ActivityItem {
  id: number;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
  user_name: string | null;
  username: string | null;
}

export interface Mention {
  comment_id: string;
  read_at: string | null;
  file_id: string;
  file_name: string;
  body: string;
  created_at: string;
  field_path: string | null;
  author_name: string;
}

export type AppEvent =
  | { type: "file"; fileId: string; action: string; by?: string }
  | { type: "files"; projectId: string; by?: string }
  | { type: "projects"; by?: string }
  | { type: "comment"; fileId: string; commentId: string; action: string; by?: string }
  | { type: "label"; fileId: string; by?: string }
  | { type: "mention"; userId: string };

export const LABELS: Record<string, string> = {
  suspicious: "Підозріле",
  verified: "Перевірено",
  fake: "Підробка",
  needs_review: "Потребує перевірки",
};

/** Field identity used to attach comments: "Group:Subgroup:Tag". */
export function fieldPath(e: { group: string; subgroup: string; tag: string }) {
  return `${e.group}:${e.subgroup}:${e.tag}`;
}

export interface VersionInfo {
  number: number;
  size: number;
  sha256: string;
  note: string | null;
  created_at: string;
  author?: string | null;
}

export type PresetId = "all" | "gps" | "personal" | "keepCopyright";

export type EditOp =
  | { kind: "set"; tag: string; value: string | number }
  | { kind: "delete"; tag: string }
  | { kind: "preset"; preset: PresetId }
  | { kind: "shiftDates"; by: string }
  | { kind: "setGps"; lat: number; lon: number; alt?: number };

export interface DiffItem {
  type: "added" | "removed" | "changed";
  group: string;
  subgroup: string;
  tag: string;
  before?: unknown;
  after?: unknown;
  risk: Risk;
}

export interface Preset {
  id: PresetId;
  label: string;
  description: string;
}

export interface Template {
  id: string;
  name: string;
  ops: EditOp[];
  created_at: string;
}

export interface EditResult {
  created: boolean;
  version?: number;
  diff: DiffItem[];
  warnings: string[];
  detail: FileDetail;
}

export interface BatchResult {
  id: string;
  ok: boolean;
  created?: boolean;
  version?: number;
  changes?: number;
  warnings?: string[];
  error?: string;
}

export interface MediaStream {
  index: number;
  type: string;
  codec?: string;
  codecLong?: string;
  profile?: string;
  width?: number;
  height?: number;
  fps?: string;
  pixFmt?: string;
  sampleRate?: string;
  channels?: number;
  channelLayout?: string;
  bitRate?: string;
  duration?: string;
  language?: string;
  tags: Record<string, string>;
}

export interface DeepReport {
  media?: {
    format?: string;
    formatLong?: string;
    duration?: string;
    size?: string;
    bitRate?: string;
    tags: Record<string, string>;
    streams: MediaStream[];
    chapters: number;
  };
  office?: {
    kind: string;
    people: string[];
    comments: { author?: string; date?: string; text: string; where?: string }[];
    revisions: { type: "insert" | "delete" | "change"; author?: string; date?: string; text: string }[];
    hiddenSheets: string[];
    notes: string[];
    externalTargets: { type: string; target: string }[];
    macros: boolean;
    embedded: { name: string; size: number; gps?: { lat: number; lon: number }; device?: string; software?: string; created?: string; author?: string }[];
    parts: number;
    truncated?: boolean;
  };
  pdf?: {
    version?: string;
    eofMarkers: number;
    incrementalUpdates: number;
    features: Record<string, number>;
    obfuscatedNames: number;
    uris: string[];
    embeddedFiles: string[];
    streamsScanned: number;
    streamsSkipped: number;
  };
  previews?: {
    tag: string;
    url: string;
    mime?: string;
    width?: number;
    height?: number;
    size: number;
    distance?: number;
    aspectMain?: number;
    aspectPreview?: number;
    differs?: boolean;
    cropped?: boolean;
  }[];
  mainImage?: { width: number; height: number; thumbUrl: string };
  trailer?: {
    format: string;
    dataEnd: number;
    size: number;
    trailingBytes: number;
    leadingBytes?: number;
    trailingType?: string;
    sampleHex?: string;
  };
  errors: string[];
}

export interface FileDetail {
  file: { id: string; original_name: string; declared_mime: string | null; detected_ext: string | null; detected_mime: string | null; created_at: string };
  version: { number: number; size: number; md5: string; sha1: string; sha256: string; note: string | null; created_at: string };
  versions: VersionInfo[];
  labels: FileLabel[];
  role: Role;
  project: { id: string; name: string };
  isLatest: boolean;
  canWrite: boolean;
  exiftoolVersion?: string;
  extractedAt?: string;
  report: Report | null;
  deep: DeepReport | null;
  entries: MetaEntry[];
}

/** Fired when any call gets 401, so the app can show the login screen. */
export const UNAUTHORIZED_EVENT = "mc:unauthorized";

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401 && !res.url.includes("/api/auth/")) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? body.errors?.[0]?.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  return fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => json<T>(r));
}
const post = <T,>(url: string, body: unknown) => send<T>("POST", url, body);
const get = <T,>(url: string) => fetch(url).then((r) => json<T>(r));

export const api = {
  hex: (fileId: string, offset: number, length: number, version?: number) =>
    get<{ offset: number; length: number; size: number; base64: string }>(
      `/api/files/${fileId}/hex?offset=${offset}&length=${length}${version ? `&version=${version}` : ""}`,
    ),
  projects: () => get<Project[]>("/api/projects"),
  createProject: (name: string, description?: string) => post<Project>("/api/projects", { name, description }),
  updateProject: (id: string, input: { name?: string; description?: string }) => send<{ ok: boolean }>("PATCH", `/api/projects/${id}`, input),
  deleteProject: (id: string) => send<{ ok: boolean }>("DELETE", `/api/projects/${id}`),
  members: (projectId: string) => get<Member[]>(`/api/projects/${projectId}/members`),
  setMember: (projectId: string, userId: string, role: Role) =>
    send<Member[]>("PUT", `/api/projects/${projectId}/members/${userId}`, { role }),
  removeMember: (projectId: string, userId: string) => send<{ ok: boolean }>("DELETE", `/api/projects/${projectId}/members/${userId}`),
  moveFile: (fileId: string, projectId: string) => post<FileDetail>(`/api/files/${fileId}/move`, { projectId }),
  me: () => get<{ user: User | null; firstRun: boolean }>("/api/auth/me"),
  login: (username: string, password: string) => post<{ user: User }>("/api/auth/login", { username, password }),
  register: (username: string, password: string, displayName: string) =>
    post<{ user: User }>("/api/auth/register", { username, password, displayName }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout", {}),
  users: () => get<User[]>("/api/users"),
  comments: (fileId: string) => get<Thread[]>(`/api/files/${fileId}/comments`),
  addComment: (fileId: string, input: { body: string; parentId?: string; fieldPath?: string; version?: number }) =>
    post<{ id: string }>(`/api/files/${fileId}/comments`, input),
  editComment: (id: string, body: string) => send<{ ok: boolean }>("PATCH", `/api/comments/${id}`, { body }),
  setThreadStatus: (id: string, status: "open" | "resolved") => send<{ ok: boolean }>("PATCH", `/api/comments/${id}`, { status }),
  deleteComment: (id: string) => send<{ ok: boolean }>("DELETE", `/api/comments/${id}`),
  setLabel: (fileId: string, label: string, on: boolean) =>
    send<FileLabel[]>(on ? "PUT" : "DELETE", `/api/files/${fileId}/labels/${label}`),
  activity: (fileId: string) => get<ActivityItem[]>(`/api/files/${fileId}/activity`),
  mentions: () => get<Mention[]>("/api/mentions"),
  markMentionsRead: (fileId?: string) => post<{ ok: boolean }>("/api/mentions/read", { fileId }),
  list: () => fetch("/api/files").then((r) => json<FileListItem[]>(r)),
  get: (id: string, version?: number) =>
    fetch(`/api/files/${id}${version ? `?version=${version}` : ""}`).then((r) => json<FileDetail>(r)),
  preview: (id: string, ops: EditOp[]) =>
    post<{ diff: DiffItem[]; warnings: string[]; changed: boolean }>(`/api/files/${id}/preview`, { ops }),
  edit: (id: string, ops: EditOp[], note?: string) => post<EditResult>(`/api/files/${id}/edit`, { ops, note }),
  revert: (id: string, version: number) => post<{ version: number; detail: FileDetail }>(`/api/files/${id}/revert`, { version }),
  diff: (id: string, a: number, b: number) => fetch(`/api/files/${id}/diff?a=${a}&b=${b}`).then((r) => json<DiffItem[]>(r)),
  batch: (ids: string[], ops: EditOp[], note?: string) => post<{ results: BatchResult[] }>("/api/batch/edit", { ids, ops, note }),
  presets: () => fetch("/api/presets").then((r) => json<Preset[]>(r)),
  templates: () => fetch("/api/templates").then((r) => json<Template[]>(r)),
  saveTemplate: (name: string, ops: EditOp[]) => post<Template>("/api/templates", { name, ops }),
  deleteTemplate: (id: string) => fetch(`/api/templates/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  upload: (files: File[], projectId: string) => {
    const fd = new FormData();
    for (const f of files) fd.append("file", f, f.name);
    return fetch(`/api/files?project=${encodeURIComponent(projectId)}`, { method: "POST", body: fd }).then((r) =>
      json<{ results: { id: string; name: string }[]; errors: { name: string; error: string }[] }>(r),
    );
  },
  reanalyze: (id: string) => fetch(`/api/files/${id}/reanalyze`, { method: "POST" }).then((r) => json<FileDetail>(r)),
  remove: (id: string) => fetch(`/api/files/${id}`, { method: "DELETE" }).then((r) => json<{ ok: boolean }>(r)),
  downloadUrl: (id: string, version?: number) => `/api/files/${id}/download${version ? `?version=${version}` : ""}`,
  exportUrl: (id: string) => `/api/files/${id}/export.json`,
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  const units = ["КБ", "МБ", "ГБ"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Tag name to use when writing an existing entry back: family-1 group + tag. */
export function writeTag(e: Pick<MetaEntry, "subgroup" | "tag">): string {
  return `${e.subgroup}:${e.tag}`;
}

const PRESET_LABELS: Record<PresetId, string> = {
  all: "Прибрати все",
  gps: "Прибрати геолокацію",
  personal: "Прибрати особисте",
  keepCopyright: "Залишити тільки авторське право",
};

export function describeOp(op: EditOp): string {
  switch (op.kind) {
    case "set": return `${op.tag} = ${String(op.value)}`;
    case "delete": return `Видалити ${op.tag}`;
    case "preset": return PRESET_LABELS[op.preset];
    case "shiftDates": return `Зсув дат ${op.by}`;
    case "setGps": return `GPS ${op.lat.toFixed(5)}, ${op.lon.toFixed(5)}`;
  }
}

/** Adds an op; a set/delete on the same tag replaces the earlier one. */
export function upsertOp(ops: EditOp[], op: EditOp): EditOp[] {
  if (op.kind === "set" || op.kind === "delete") {
    const tag = op.tag.toLowerCase();
    return [...ops.filter((o) => !((o.kind === "set" || o.kind === "delete") && o.tag.toLowerCase() === tag)), op];
  }
  if (op.kind === "setGps" || op.kind === "shiftDates") return [...ops.filter((o) => o.kind !== op.kind), op];
  if (op.kind === "preset") return [...ops.filter((o) => !(o.kind === "preset" && o.preset === op.preset)), op];
  return [...ops, op];
}
