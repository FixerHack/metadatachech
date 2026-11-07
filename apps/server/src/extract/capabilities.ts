import { ExifToolTask } from "exiftool-vendored";
import { et } from "./exiftool.js";

/** Runs exiftool with fixed args and returns stdout. Only for static, trusted args. */
class RawTask extends ExifToolTask<string> {
  protected parse(input: string, error?: Error): string {
    if (error) throw error;
    return input;
  }
}

function words(out: string): string[] {
  return out
    .split(/\r?\n/)
    .slice(1) // header line, e.g. "Writable tags:"
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
}

let cache: Promise<{ tags: Set<string>; fileTypes: Set<string> }> | null = null;

/** Lower-cased names of every tag ExifTool can write, and writable file extensions. */
export function capabilities() {
  cache ??= (async () => {
    const [tags, types] = await Promise.all([
      et.enqueueTask(() => new RawTask(["-listw"])),
      et.enqueueTask(() => new RawTask(["-listwf"])),
    ]);
    return {
      tags: new Set(words(tags).map((w) => w.toLowerCase())),
      fileTypes: new Set(words(types).map((w) => w.toUpperCase())),
    };
  })();
  return cache;
}

/** Groups that describe the file or are computed — never directly writable. */
// Deep-analysis groups (FFprobe, Office, PDFScan, Structure) come from our own extractors, not ExifTool.
const READONLY_GROUPS = new Set(["File", "System", "Composite", "ExifTool", "FFprobe", "Office", "PDFScan", "Structure"]);

export async function isTagWritable(group: string, tag: string) {
  if (READONLY_GROUPS.has(group)) return false;
  return (await capabilities()).tags.has(tag.toLowerCase());
}

export async function canWriteFileType(fileTypeExt?: string | null) {
  if (!fileTypeExt) return false;
  return (await capabilities()).fileTypes.has(fileTypeExt.toUpperCase());
}
