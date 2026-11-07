// Runs the full analysis on local files and prints the deep-analysis findings.
// Usage (from apps/server): npx tsx scripts/deep-check.ts ../../samples/deep/*
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { et } from "../src/extract/exiftool.js";
import { buildReport } from "../src/report.js";
import { extractExif } from "../src/extract/exiftool.js";
import { deepEntries, runDeep } from "../src/extract/deep.js";

const out = fs.mkdtempSync(path.join(os.tmpdir(), "mc-deepcheck-"));
try {
  for (const file of process.argv.slice(2)) {
    const ft = await fileTypeFromFile(file).catch(() => undefined);
    const { entries: exif, warnings } = await extractExif(file);
    const deep = await runDeep(file, {
      mime: ft?.mime,
      ext: ft?.ext,
      entries: exif,
      outDir: path.join(out, path.basename(file)),
      urlFor: (n) => `/derived/${n}`,
    });
    const entries = [...exif, ...deepEntries(deep)];
    const report = buildReport(entries, { originalName: path.basename(file), detectedExt: ft?.ext, detectedMime: ft?.mime, warnings: [...warnings, ...deep.errors], deep });

    console.log(`\n=== ${path.basename(file)} (${ft?.mime ?? "?"}) — ${exif.length} exif + ${entries.length - exif.length} deep entries`);
    const deepGroups = entries.filter((e) => ["FFprobe", "Office", "PDFScan", "Structure"].includes(e.group));
    for (const e of deepGroups.slice(0, 40)) console.log(`  [${e.risk[0]}] ${e.group}:${e.subgroup}:${e.tag} = ${String(e.value).slice(0, 110)}`);
    if (deepGroups.length > 40) console.log(`  … +${deepGroups.length - 40}`);
    if (deep.previews) for (const p of deep.previews) console.log(`  preview ${p.tag}: ${p.width}x${p.height} distance=${p.distance} differs=${p.differs} cropped=${p.cropped}`);
    if (deep.mainImage) console.log(`  main ${deep.mainImage.width}x${deep.mainImage.height}`);
    console.log("  anomalies:");
    for (const a of report.anomalies) console.log(`   ${a.level === "warning" ? "!" : "·"} ${a.message}`);
  }
} finally {
  fs.rmSync(out, { recursive: true, force: true });
  await et.end();
}
