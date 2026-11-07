import type { Risk } from "./types.js";

interface Rule {
  re: RegExp;
  risk: Risk;
  reason: string;
}

/** Ordered: first match wins. Matched against the tag name. */
const TAG_RULES: Rule[] = [
  { re: /^GPS|^Location|GeoTag|^Coordinates$/i, risk: "high", reason: "Геолокація" },
  { re: /SerialNumber|SerialNum|InternalSerial|BodySerial|UniqueCameraModel|ImageUniqueID|DeviceID$/i, risk: "high", reason: "Унікальний ідентифікатор пристрою" },
  { re: /^(Artist|Author|Creator|By-?line|OwnerName|CameraOwnerName|LastModifiedBy|XPAuthor|Company|Manager|Credit|Contact.*|CreatorContactInfo.*|Rights?Owner|Copyright ?Owner.*)$/i, risk: "high", reason: "Особа або організація" },
  { re: /e-?mail/i, risk: "high", reason: "Контактні дані" },
  { re: /^(City|Sub-?location|State|Province-State|Country.*|LocationShown.*|LocationCreated.*)$/i, risk: "high", reason: "Місце зйомки" },
  { re: /^(Make|Model|LensModel|LensMake|LensID|LensInfo|CameraModelName|DeviceManufacturer|DeviceModel)$/i, risk: "medium", reason: "Модель пристрою" },
  { re: /^(Software|CreatorTool|HistorySoftwareAgent|Producer|Application|AppVersion|HostComputer|Encoder|EncodedBy|WritingApp|MuxingApp)$/i, risk: "medium", reason: "Програмне забезпечення" },
  { re: /^(DateTimeOriginal|CreateDate|ModifyDate|DigitalCreationDate.*|DateCreated|MetadataDate|CreationDate|TrackCreateDate|MediaCreateDate|SubSecDateTimeOriginal|OffsetTime.*)$/i, risk: "medium", reason: "Дата й час" },
  { re: /^(DocumentID|InstanceID|OriginalDocumentID|DerivedFrom.*|History.*|Ingredients.*|RevisionNumber|TotalEditTime|Template|LastPrinted)$/i, risk: "medium", reason: "Історія редагування" },
  { re: /^(UserComment|Comment|XPComment|ImageDescription|Description|Caption-Abstract|Title|XPTitle|Subject|XPSubject|Keywords|XPKeywords|Headline|Instructions|Notes?)$/i, risk: "medium", reason: "Довільний текст" },
  { re: /^(ThumbnailImage|PreviewImage|JpgFromRaw|OtherImage|CoverArt|Picture)$/i, risk: "medium", reason: "Вбудоване зображення (може відрізнятись від основного)" },
];

const VALUE_RULES: Rule[] = [
  { re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, risk: "high", reason: "Містить e-mail" },
  { re: /[A-Z]:\\(Users|Documents and Settings)\\[^\\]+|\/(home|Users)\/[^/\s]+/i, risk: "high", reason: "Містить шлях з імʼям користувача" },
  { re: /\+?\d[\d\s()-]{8,}\d/, risk: "medium", reason: "Схоже на номер телефону" },
];

const SAFE_GROUPS = new Set(["File", "System", "ExifTool", "Composite"]);

const RANK: Record<Risk, number> = { low: 0, medium: 1, high: 2 };

/** Highest risk of the tag-name rule and the value-content rule wins. */
export function classify(tag: string, value: unknown, group: string): { risk: Risk; reason?: string } {
  let best: { risk: Risk; reason?: string } = { risk: "low" };
  const byTag = TAG_RULES.find((r) => r.re.test(tag));
  if (byTag) best = { risk: byTag.risk, reason: byTag.reason };
  if (typeof value === "string" && !SAFE_GROUPS.has(group)) {
    const byValue = VALUE_RULES.find((r) => r.re.test(value));
    if (byValue && RANK[byValue.risk] > RANK[best.risk]) best = { risk: byValue.risk, reason: byValue.reason };
  }
  return best;
}
