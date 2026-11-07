import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffprobeStatic from "ffprobe-static";
import type { MediaInfo, MediaStream } from "../types.js";

const run = promisify(execFile);

/** Bundled ffprobe; override with FFPROBE_PATH (e.g. a newer system build in production). */
const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic.path;

type Raw = Record<string, unknown>;
const str = (v: unknown) => (v == null || v === "" ? undefined : String(v));
const tagsOf = (o: Raw | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  const t = (o?.tags ?? {}) as Raw;
  for (const [k, v] of Object.entries(t)) if (v != null && v !== "") out[k] = String(v).slice(0, 2000);
  return out;
};

/** Container + per-stream technical metadata. Runs without a shell, with a hard timeout. */
export async function probeMedia(filePath: string): Promise<MediaInfo | undefined> {
  const { stdout } = await run(
    FFPROBE,
    ["-v", "error", "-hide_banner", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters", filePath],
    { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  const json = JSON.parse(stdout) as { format?: Raw; streams?: Raw[]; chapters?: unknown[] };
  if (!json.format && !json.streams?.length) return undefined;

  const streams: MediaStream[] = (json.streams ?? []).map((s) => {
    const disposition = (s.disposition ?? {}) as Raw;
    const type = String(s.codec_type ?? "unknown");
    return {
      index: Number(s.index ?? 0),
      // Cover art arrives as a "video" stream with attached_pic.
      type: disposition.attached_pic ? "cover" : type,
      codec: str(s.codec_name),
      codecLong: str(s.codec_long_name),
      profile: str(s.profile),
      width: s.width ? Number(s.width) : undefined,
      height: s.height ? Number(s.height) : undefined,
      fps: type === "video" ? str(s.avg_frame_rate !== "0/0" ? s.avg_frame_rate : s.r_frame_rate) : undefined,
      pixFmt: str(s.pix_fmt),
      sampleRate: str(s.sample_rate),
      channels: s.channels ? Number(s.channels) : undefined,
      channelLayout: str(s.channel_layout),
      bitRate: str(s.bit_rate),
      duration: str(s.duration),
      language: str((s.tags as Raw | undefined)?.language),
      tags: tagsOf(s),
    };
  });

  const f = json.format ?? {};
  return {
    format: str(f.format_name),
    formatLong: str(f.format_long_name),
    duration: str(f.duration),
    size: str(f.size),
    bitRate: str(f.bit_rate),
    tags: tagsOf(f),
    streams,
    chapters: json.chapters?.length ?? 0,
  };
}

/** ffprobe also "understands" images; only run it for real audio/video. */
export function isMediaType(mime?: string | null, ext?: string | null) {
  if (mime && /^(video|audio)\//.test(mime)) return true;
  return !!ext && /^(mp4|m4v|m4a|mov|3gp|3g2|mkv|webm|avi|wmv|asf|flv|mpg|mpeg|ts|mts|m2ts|mp3|wav|flac|ogg|oga|opus|aac|aif|aiff|wma|amr)$/i.test(ext);
}
