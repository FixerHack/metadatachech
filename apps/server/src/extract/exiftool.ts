import { ExifTool } from "exiftool-vendored";
import type { MetaEntry } from "../types.js";
import { classify } from "../risk.js";

export const et = new ExifTool({ taskTimeoutMillis: 60_000, maxProcs: 4 });

/**
 * -G0:1  family 0 + 1 group names ("EXIF:IFD0:Make")
 * -a     keep duplicate tags
 * -u     include unknown tags
 * -ee3   extract embedded data (video timed metadata, embedded files)
 */
const BASE_ARGS = ["-G0:1", "-a", "-u", "-ee3", "-api", "largefilesupport=1", "-api", "struct=0"];

/** System tags that describe *our* storage, not the user's file. */
const HIDDEN_SYSTEM_TAGS = new Set([
  "SourceFile",
  "FileName",
  "Directory",
  "FilePermissions",
  "FileModifyDate",
  "FileAccessDate",
  "FileCreateDate",
  "FileInodeChangeDate",
  "FileAttributes",
]);

const BINARY_RE = /^\(Binary data \d+ bytes/;

function splitKey(key: string): { group: string; subgroup: string; tag: string } {
  const parts = key.split(":");
  if (parts.length >= 3) return { group: parts[0], subgroup: parts[1], tag: parts.slice(2).join(":") };
  if (parts.length === 2) return { group: parts[0], subgroup: parts[0], tag: parts[1] };
  return { group: "Other", subgroup: "Other", tag: key };
}

export async function extractExif(filePath: string): Promise<{ entries: MetaEntry[]; warnings: string[] }> {
  const [human, numeric] = await Promise.all([
    et.readRaw(filePath, { readArgs: BASE_ARGS, ignoreMinorErrors: true }),
    et.readRaw(filePath, { readArgs: [...BASE_ARGS, "-n"], ignoreMinorErrors: true }),
  ]);

  const h = human as Record<string, unknown>;
  const n = numeric as Record<string, unknown>;
  const entries: MetaEntry[] = [];
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(h)) {
    // exiftool-vendored adds these wrapper keys; they are not tags.
    if (key === "SourceFile") continue;
    if (key === "errors" || key === "warnings") {
      if (Array.isArray(value)) warnings.push(...value.map(String));
      continue;
    }
    const { group, subgroup, tag } = splitKey(key);
    if (HIDDEN_SYSTEM_TAGS.has(tag) && group === "File") continue;
    if (tag === "Warning" || tag === "Error") warnings.push(String(value));
    const raw = n[key];
    const isBinary = typeof value === "string" && BINARY_RE.test(value);
    const { risk, reason } = classify(tag, value, group);
    const entry: MetaEntry = { group, subgroup, tag, value, risk };
    if (reason) entry.riskReason = reason;
    if (isBinary) entry.binary = true;
    if (raw !== undefined && JSON.stringify(raw) !== JSON.stringify(value)) entry.raw = raw;
    entries.push(entry);
  }
  return { entries, warnings: [...new Set(warnings)] };
}

export async function exiftoolVersion(): Promise<string> {
  return et.version();
}
