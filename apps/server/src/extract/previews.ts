import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fileTypeFromFile } from "file-type";
import { et } from "./exiftool.js";
import type { MetaEntry, PreviewInfo } from "../types.js";

/** Binary tags that hold a whole picture of their own. */
export const PREVIEW_TAGS = ["ThumbnailImage", "PreviewImage", "JpgFromRaw", "OtherImage", "PreviewTIFF", "Picture", "CoverArt"];

// libvips must never pull in remote resources or decode absurd pixel counts.
sharp.cache(false);
const SHARP_OPTS = { limitInputPixels: 100_000_000, failOn: "none" as const };

/** 64-bit difference hash: robust to scaling/compression, changes when content changes. */
async function dHash(input: string | Buffer): Promise<bigint> {
  const raw = await sharp(input, SHARP_OPTS).grayscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = (h << 1n) | (raw[y * 9 + x] > raw[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return h;
}

function hamming(a: bigint, b: bigint) {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Previews whose hash differs by more than this many bits show a different picture. */
const DIFFERS_AT = 12;
/** Aspect-ratio gap that suggests the main image was cropped after the preview was made. */
const CROP_AT = 0.04;

/**
 * Extracts embedded pictures into `outDir`, and compares each with the main image.
 * `urlFor(tag)` builds the URL the UI uses to fetch the extracted file.
 */
export async function analyzePreviews(
  filePath: string,
  entries: MetaEntry[],
  outDir: string,
  urlFor: (name: string) => string,
): Promise<{ previews: PreviewInfo[]; main?: { width: number; height: number; thumbUrl: string } }> {
  fs.mkdirSync(outDir, { recursive: true });

  // The main image (only for formats libvips can decode).
  let main: { width: number; height: number; thumbUrl: string } | undefined;
  let mainHash: bigint | undefined;
  try {
    const meta = await sharp(filePath, SHARP_OPTS).metadata();
    if (meta.width && meta.height) {
      await sharp(filePath, SHARP_OPTS).rotate().resize(640, 640, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(outDir, "main.webp"));
      main = { width: meta.width, height: meta.height, thumbUrl: urlFor("main.webp") };
      mainHash = await dHash(filePath);
    }
  } catch {
    /* not an image sharp can read (video, PDF, document…) */
  }

  const present = new Set(entries.filter((e) => e.binary).map((e) => e.tag));
  const previews: PreviewInfo[] = [];
  for (const tag of PREVIEW_TAGS.filter((t) => present.has(t))) {
    const dest = path.join(outDir, `${tag}.bin`);
    try {
      fs.rmSync(dest, { force: true });
      await et.extractBinaryTag(tag, filePath, dest);
      const size = fs.statSync(dest).size;
      if (!size) continue;
      const ft = await fileTypeFromFile(dest).catch(() => undefined);
      const p: PreviewInfo = { tag, url: urlFor(`${tag}.bin`), mime: ft?.mime, size };
      try {
        const m = await sharp(dest, SHARP_OPTS).metadata();
        p.width = m.width;
        p.height = m.height;
        if (main && mainHash !== undefined && m.width && m.height) {
          p.distance = hamming(mainHash, await dHash(dest));
          // Previews are stored unrotated, like the main image's raw pixels.
          const raw = await sharp(filePath, SHARP_OPTS).metadata();
          p.aspectMain = +(raw.width! / raw.height!).toFixed(3);
          p.aspectPreview = +(m.width / m.height).toFixed(3);
          p.differs = p.distance > DIFFERS_AT;
          p.cropped = Math.abs(p.aspectMain - p.aspectPreview) / p.aspectMain > CROP_AT;
        }
      } catch {
        /* preview not decodable — still offered for download */
      }
      previews.push(p);
    } catch {
      /* tag listed but not extractable */
    }
  }
  return { previews, main };
}
