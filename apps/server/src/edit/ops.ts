import type { WriteTags } from "exiftool-vendored";

/** One editing operation. A request is an ordered list of these. */
export type EditOp =
  | { kind: "set"; tag: string; value: string | number }
  | { kind: "delete"; tag: string }
  | { kind: "preset"; preset: PresetId }
  | { kind: "shiftDates"; by: string }
  | { kind: "setGps"; lat: number; lon: number; alt?: number };

export type PresetId = "all" | "gps" | "personal" | "keepCopyright";

/** Same rule exiftool-vendored enforces, plus no leading dash. */
const TAG_RE = /^[\w*?][\w:\-*?#]*$/;
/** ExifTool date shift: "+1:30", "-0:0:1 2:00:00", "+1 0:0:0" (Y:M:D H:M:S, shorter forms allowed). */
const SHIFT_RE = /^[+-]\d{1,4}(:\d{1,4}){0,2}( \d{1,4}(:\d{1,4}){0,2})?$/;

/** Dates shifted by "shiftDates". ExifTool only touches the ones that exist. */
const SHIFT_TAGS = [
  "AllDates",
  "XMP:DateCreated",
  "XMP:MetadataDate",
  "QuickTime:CreateDate",
  "QuickTime:ModifyDate",
  "QuickTime:TrackCreateDate",
  "QuickTime:TrackModifyDate",
  "QuickTime:MediaCreateDate",
  "QuickTime:MediaModifyDate",
];

const KEEP_RENDERING =["-tagsFromFile", "@", "-ICC_Profile", "-Orientation"];

const GPS_ARGS = [
  "-GPS*=",
  "-XMP:Location*=",
  "-XMP-iptcExt:LocationCreated*=",
  "-XMP-iptcExt:LocationShown*=",
  "-Sub-location=",
  "-City=",
  "-State=",
  "-Province-State=",
  "-Country=",
  "-Country-PrimaryLocationName=",
  "-Country-PrimaryLocationCode=",
  "-CountryCode=",
  "-Location=",
  "-LocationName=",
];

const PERSONAL_ARGS = [
  ...GPS_ARGS,
  "-Artist=",
  "-Author=",
  "-Creator=",
  "-By-line=",
  "-By-lineTitle=",
  "-Credit=",
  "-OwnerName=",
  "-CameraOwnerName=",
  "-*SerialNumber=",
  "-ImageUniqueID=",
  "-LastModifiedBy=",
  "-Company=",
  "-Manager=",
  "-XPAuthor=",
  "-XPComment=",
  "-UserComment=",
  "-Comment=",
  "-HostComputer=",
  "-Software=",
  "-CreatorTool=",
  "-XMP-xmpMM:all=",
  "-XMP-photoshop:DocumentAncestors*=",
  "-XMP-iptcCore:CreatorContactInfo*=",
  "-ThumbnailImage=",
  "-PreviewImage=",
];

export const PRESETS: Record<PresetId, { label: string; description: string; args: string[] }> = {
  all: {
    label: "Прибрати все",
    description: "Видаляє всі метадані, що підтримують запис. Колірний профіль і орієнтація залишаються, щоб зображення не змінилось візуально.",
    args: ["-all=", ...KEEP_RENDERING],
  },
  gps: {
    label: "Прибрати геолокацію",
    description: "GPS-координати, висота, напрямок, а також місто, країна та інші поля місця.",
    args: GPS_ARGS,
  },
  personal: {
    label: "Прибрати особисте",
    description: "Геолокація, автор, власник, серійні номери, ПЗ, коментарі, історія редагувань XMP і вбудовані превʼю.",
    args: PERSONAL_ARGS,
  },
  keepCopyright: {
    label: "Залишити тільки авторське право",
    description: "Видаляє все, крім Copyright / Rights, колірного профілю та орієнтації.",
    args: ["-all=", ...KEEP_RENDERING, "-Copyright", "-XMP-dc:Rights", "-IPTC:CopyrightNotice"],
  },
};

export class EditError extends Error {
  statusCode = 400;
}

export function validateOps(input: unknown): EditOp[] {
  if (!Array.isArray(input) || input.length === 0) throw new EditError("Немає змін для застосування");
  if (input.length > 500) throw new EditError("Забагато змін за один раз (макс. 500)");
  return input.map((op, i): EditOp => {
    const o = op as Record<string, unknown>;
    const where = `Зміна #${i + 1}`;
    switch (o?.kind) {
      case "set": {
        if (typeof o.tag !== "string" || !TAG_RE.test(o.tag) || /[*?]/.test(o.tag)) throw new EditError(`${where}: некоректна назва тегу`);
        if (typeof o.value !== "string" && typeof o.value !== "number") throw new EditError(`${where}: значення має бути рядком або числом`);
        if (String(o.value).length > 64_000) throw new EditError(`${where}: значення задовге`);
        return { kind: "set", tag: o.tag, value: o.value };
      }
      case "delete":
        if (typeof o.tag !== "string" || !TAG_RE.test(o.tag)) throw new EditError(`${where}: некоректна назва тегу`);
        return { kind: "delete", tag: o.tag };
      case "preset":
        if (typeof o.preset !== "string" || !(o.preset in PRESETS)) throw new EditError(`${where}: невідомий пресет`);
        return { kind: "preset", preset: o.preset as PresetId };
      case "shiftDates":
        if (typeof o.by !== "string" || !SHIFT_RE.test(o.by.trim())) throw new EditError(`${where}: зсув має вигляд +1:30 або -0:0:1 0:0:0`);
        return { kind: "shiftDates", by: o.by.trim() };
      case "setGps": {
        const lat = Number(o.lat), lon = Number(o.lon);
        if (!(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) throw new EditError(`${where}: некоректні координати`);
        const alt = o.alt == null || o.alt === "" ? undefined : Number(o.alt);
        if (alt !== undefined && !Number.isFinite(alt)) throw new EditError(`${where}: некоректна висота`);
        return { kind: "setGps", lat, lon, alt };
      }
      default:
        throw new EditError(`${where}: невідомий тип "${String(o?.kind)}"`);
    }
  });
}

/**
 * ExifTool processes deletions like `-all=` together with assignments, and
 * exiftool-vendored places tag assignments before extra args. To keep the
 * user's intent ("strip, then set Copyright") we split into ordered passes.
 */
export function planPasses(ops: EditOp[]): { tags: WriteTags; args: string[] }[] {
  const passes: { tags: WriteTags; args: string[] }[] = [];
  let current: { tags: WriteTags; args: string[] } | null = null;
  let mode: "args" | "tags" | null = null;

  const need = (m: "args" | "tags") => {
    if (!current || mode !== m) {
      current = { tags: {}, args: [] };
      passes.push(current);
      mode = m;
    }
    return current;
  };

  for (const op of ops) {
    switch (op.kind) {
      case "preset":
        need("args").args.push(...PRESETS[op.preset].args);
        break;
      case "shiftDates": {
        const sign = op.by[0];
        const amount = op.by.slice(1);
        need("args").args.push(...SHIFT_TAGS.map((t) => `-${t}${sign}=${amount}`));
        break;
      }
      case "set":
        (need("tags").tags as Record<string, unknown>)[op.tag] = op.value;
        break;
      case "delete":
        (need("tags").tags as Record<string, unknown>)[op.tag] = null;
        break;
      case "setGps": {
        const t = need("tags").tags as Record<string, unknown>;
        t.GPSLatitude = op.lat;
        t.GPSLongitude = op.lon;
        if (op.alt !== undefined) t.GPSAltitude = op.alt;
        break;
      }
    }
  }
  return passes;
}
