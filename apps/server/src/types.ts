export type Risk = "high" | "medium" | "low";

export interface MetaEntry {
  /** Family-0 group, e.g. "EXIF", "XMP", "MakerNotes", "QuickTime". */
  group: string;
  /** Family-1 group, e.g. "IFD0", "ExifIFD", "XMP-dc", "Canon". */
  subgroup: string;
  tag: string;
  /** Human-readable value (ExifTool print conversion). */
  value: unknown;
  /** Raw/numeric value (ExifTool -n), only when it differs from `value`. */
  raw?: unknown;
  binary?: boolean;
  /** Filled at read time: ExifTool can write this tag in this file type. */
  writable?: boolean;
  risk: Risk;
  riskReason?: string;
}

export interface Anomaly {
  level: "warning" | "info";
  code: string;
  message: string;
}

// ---- Deep analysis (format-specific extractors) --------------------------------

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

export interface MediaInfo {
  format?: string;
  formatLong?: string;
  duration?: string;
  size?: string;
  bitRate?: string;
  tags: Record<string, string>;
  streams: MediaStream[];
  chapters: number;
}

export interface OfficeComment {
  author?: string;
  date?: string;
  text: string;
  where?: string;
}

export interface OfficeRevision {
  type: "insert" | "delete" | "change";
  author?: string;
  date?: string;
  text: string;
}

export interface EmbeddedMeta {
  name: string;
  size: number;
  gps?: { lat: number; lon: number };
  device?: string;
  software?: string;
  created?: string;
  author?: string;
}

export interface OfficeInfo {
  kind: "docx" | "xlsx" | "pptx" | "odf" | "zip";
  people: string[];
  comments: OfficeComment[];
  revisions: OfficeRevision[];
  hiddenSheets: string[];
  notes: string[];
  externalTargets: { type: string; target: string }[];
  macros: boolean;
  embedded: EmbeddedMeta[];
  parts: number;
  truncated?: boolean;
}

export interface PdfInfo {
  version?: string;
  eofMarkers: number;
  incrementalUpdates: number;
  features: Record<string, number>;
  obfuscatedNames: number;
  uris: string[];
  embeddedFiles: string[];
  streamsScanned: number;
  streamsSkipped: number;
}

export interface PreviewInfo {
  tag: string;
  url: string;
  mime?: string;
  width?: number;
  height?: number;
  size: number;
  /** Hamming distance of 64-bit difference hashes vs the main image (0 = same picture). */
  distance?: number;
  aspectMain?: number;
  aspectPreview?: number;
  differs?: boolean;
  cropped?: boolean;
}

export interface TrailerInfo {
  format: string;
  /** Byte offset where the format says the file should end. */
  dataEnd: number;
  size: number;
  trailingBytes: number;
  leadingBytes?: number;
  trailingType?: string;
  sampleHex?: string;
}

export interface DeepReport {
  media?: MediaInfo;
  office?: OfficeInfo;
  pdf?: PdfInfo;
  previews?: PreviewInfo[];
  mainImage?: { width: number; height: number; thumbUrl: string };
  trailer?: TrailerInfo;
  errors: string[];
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
