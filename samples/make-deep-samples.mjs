// Generates test files for the format-specific extractors. Run from the repo root:
//   node samples/make-sample.mjs && node samples/make-deep-samples.mjs
// Output: samples/deep/*
import fs from "node:fs";
import zlib from "node:zlib";
import sharp from "sharp";
import { zipSync, strToU8 } from "fflate";
import { ExifTool } from "exiftool-vendored";

const OUT = "samples/deep";
fs.mkdirSync(OUT, { recursive: true });
const et = new ExifTool();

// ---- 1. JPEG: thumbnail shows a different picture + a ZIP appended after EOI ----------
{
  const main = `${OUT}/edited-photo.jpg`;
  fs.copyFileSync("samples/sample.jpg", main); // has GPS, author, Photoshop
  const otherThumb = `${OUT}/_thumb.jpg`;
  // Stripes instead of the blue/gold circle: a clearly different picture.
  const stripes = Buffer.alloc(160 * 100 * 3);
  for (let y = 0; y < 100; y++) for (let x = 0; x < 160; x++) {
    const on = Math.floor(x / 20) % 2 === 0;
    stripes.set(on ? [220, 30, 30] : [250, 250, 250], (y * 160 + x) * 3);
  }
  await sharp(stripes, { raw: { width: 160, height: 100, channels: 3 } }).jpeg().toFile(otherThumb);
  await et.write(main, {}, { writeArgs: ["-overwrite_original", `-ThumbnailImage<=${otherThumb}`] });
  fs.rmSync(otherThumb);
  const hidden = zipSync({ "secret.txt": strToU8("hidden payload after the image") });
  fs.appendFileSync(main, Buffer.from(hidden));
}

// ---- 2. DOCX: comment, tracked insert/delete, people, local template, image with GPS ----
{
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Олена Коваль</dc:creator><cp:lastModifiedBy>Ігор Бондар</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2026-03-01T09:00:00Z</dcterms:created></cp:coreProperties>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body><w:p><w:r><w:t>Бюджет проєкту: </w:t></w:r><w:del w:id="1" w:author="Ігор Бондар" w:date="2026-03-02T10:00:00Z"><w:r><w:delText>2 000 000 грн</w:delText></w:r></w:del><w:ins w:id="2" w:author="Ігор Бондар" w:date="2026-03-02T10:00:05Z"><w:r><w:t>1 200 000 грн</w:t></w:r></w:ins><w:commentRangeStart w:id="0"/><w:r><w:t> (погоджено)</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p></w:body></w:document>`),
    "word/comments.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="Марія Ткач" w:date="2026-03-02T11:00:00Z" w:initials="МТ"><w:p><w:r><w:t>Не показувати клієнту справжню суму</w:t></w:r></w:p></w:comment></w:comments>`),
    "word/people.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Ігор Бондар"/><w15:person w15:author="Марія Ткач"/></w15:people>`),
    "word/_rels/settings.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="file:///C:\\Users\\ihor.bondar\\Documents\\Templates\\Budget.dotx" TargetMode="External"/></Relationships>`),
    "word/media/image1.jpg": new Uint8Array(fs.readFileSync("samples/sample.jpg")),
  };
  fs.writeFileSync(`${OUT}/review.docx`, Buffer.from(zipSync(files)));
}

// ---- 3. XLSX: hidden sheet + cell comment ----------------------------------------------
{
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Звіт" sheetId="1" r:id="rId1"/><sheet name="Справжні цифри" sheetId="2" state="veryHidden" r:id="rId2"/></sheets></workbook>`),
    "xl/comments1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><authors><author>Петро Сидоренко</author></authors><commentList><comment ref="B4" authorId="0"><text><r><t>Цифру занижено вручну</t></r></text></comment></commentList></comments>`),
  };
  fs.writeFileSync(`${OUT}/report.xlsx`, Buffer.from(zipSync(files)));
}

// ---- 4. PDF: JS inside a Flate object stream, obfuscated name, attachment, link, update --
{
  const objStmBody = "6 0 << /S /JavaScript /JS (app.alert\\('hi'\\)) >>";
  const objStm = zlib.deflateSync(Buffer.from(`6 0 ${objStmBody.slice(4)}`, "latin1"));
  const parts = [];
  const offsets = [];
  let pos = 0;
  const push = (s) => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, "latin1"); parts.push(b); pos += b.length; };
  const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R /Names << /EmbeddedFiles << /Names [(invoice.exe) 7 0 R] >> >> >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [4 0 R] >>");
  obj(4, "<< /Type /Annot /Subtype /Link /Rect [0 0 100 20] /A << /S /URI /URI (https://example.com/track?id=42) >> >>");
  offsets[5] = pos;
  push(`5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${objStm.length} >>\nstream\n`);
  push(objStm);
  push("\nendstream\nendobj\n");
  obj(7, "<< /Type /Filespec /F (invoice.exe) /UF (invoice.exe) /EF << /F 8 0 R >> >>");
  obj(8, "<< /Type /EmbeddedFile /Length 5 >>\nstream\nMZ...\nendstream");
  obj(9, "<< /S /J#61vaScript /JS (void 0) >>");
  const xref1 = pos;
  push(`xref\n0 10\n0000000000 65535 f \n${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${String(offsets[n] ?? 0).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 10 /Root 1 0 R /Info << /Author (Original Author) /Title (Draft v1) >> >>\nstartxref\n${xref1}\n%%EOF\n`);
  // Incremental update: new Info dictionary replacing the old one.
  obj(10, "<< /Author (Public Name) /Title (Final) >>");
  const xref2 = pos;
  push(`xref\n10 1\n${String(offsets[10]).padStart(10, "0")} 00000 n \ntrailer\n<< /Size 11 /Root 1 0 R /Info 10 0 R /Prev ${xref1} >>\nstartxref\n${xref2}\n%%EOF\n`);
  fs.writeFileSync(`${OUT}/active.pdf`, Buffer.concat(parts));
}

// ---- 5. WAV with RIFF INFO tags (artist, comment, software) -----------------------------
{
  const rate = 8000, seconds = 1;
  const pcm = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) pcm.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), i * 2);
  const info = (id, text) => {
    const t = Buffer.from(text + "\0", "utf8");
    const pad = t.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
    const h = Buffer.alloc(8); h.write(id, 0, "latin1"); h.writeUInt32LE(t.length, 4);
    return Buffer.concat([h, t, pad]);
  };
  const list = Buffer.concat([Buffer.from("INFO"), info("IART", "Dmytro Shevchenko"), info("ICMT", "recorded at office, room 4"), info("ISFT", "Lavf58.29.100")]);
  const listHdr = Buffer.alloc(8); listHdr.write("LIST", 0); listHdr.writeUInt32LE(list.length, 4);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * 2, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const dataHdr = Buffer.alloc(8); dataHdr.write("data", 0); dataHdr.writeUInt32LE(pcm.length, 4);
  const body = Buffer.concat([Buffer.from("WAVE"), fmt, listHdr, list, dataHdr, pcm]);
  const riff = Buffer.alloc(8); riff.write("RIFF", 0); riff.writeUInt32LE(body.length, 4);
  fs.writeFileSync(`${OUT}/voice.wav`, Buffer.concat([riff, body]));
}

await et.end();
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(`${OUT}/${f}`).size, "bytes");
