// Visual check of the whole chain (detect -> crop -> PaddleOCR -> post-process) on test images.
// No ground-truth strings exist yet (docs 4.6), so this writes a contact sheet to compare by eye.
//   node scripts/ocr-eval.ts [count] [mode]   -> scripts/out/ocr-sheet.jpg + ocr-results.csv
import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import ort from "onnxruntime-node";
import { decode, type ResizeMode } from "../src/recognition/image.ts";
import { detectPlates } from "../src/recognition/detect.ts";
import { loadOcr, readPlate } from "../src/recognition/ocr.ts";
import { postprocess } from "../src/recognition/postprocess.ts";

const count = Number(process.argv[2] ?? 40);
const mode = (process.argv[3] ?? "stretch") as ResizeMode;
const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const OUT = path.join(import.meta.dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const det = await ort.InferenceSession.create(path.join(M, "plate.onnx"));
const models = {
  en_v3: await loadOcr(path.join(M, "rec_en_v3.onnx"), path.join(M, "en_dict.txt")),
  ch_v4: await loadOcr(path.join(M, "rec_ch_v4.onnx"), path.join(M, "ppocr_keys_v1.txt")),
};
for (const [k, m] of Object.entries(models)) {
  const o = m.session.outputNames[0];
  console.log(`${k}: ${m.chars.length} labels, output ${o}`);
}

// spread the sample over all sources
const dir = path.join(ROOT, "datasets/vn-plate/test/images");
const all = fs.readdirSync(dir).sort();
const step = Math.max(1, Math.floor(all.length / count));
const files = all.filter((_, i) => i % step === 0).slice(0, count);

const TILE_W = 300, TILE_H = 170;
const tiles: OverlayOptions[] = [];
const csv = ["file,type,det_conf,model,raw,norm,text,valid,ocr_conf,ms"];
let k = 0;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

for (const f of files) {
  const img = await decode(path.join(dir, f));
  const boxes = await detectPlates(det, img, { mode });
  for (const b of boxes.slice(0, 2)) {
    const lines: string[] = [];
    let cropRgb: { data: Buffer; width: number; height: number } | null = null;
    for (const [name, m] of Object.entries(models)) {
      const t0 = performance.now();
      const r = await readPlate(m, img, b);
      const ms = performance.now() - t0;
      const p = postprocess(r.rows);
      cropRgb = r.crop;
      lines.push(`${name}: ${p.valid ? p.text : `${r.raw} ✗`}`);
      csv.push([f, b.type, b.conf.toFixed(3), name, JSON.stringify(r.raw), p.norm, JSON.stringify(p.text), p.valid, r.conf.toFixed(3), ms.toFixed(0)].join(","));
    }
    const thumb = await sharp(cropRgb!.data, { raw: { width: cropRgb!.width, height: cropRgb!.height, channels: 3 } })
      .resize(TILE_W - 20, 100, { fit: "contain", background: "#222" })
      .png()
      .toBuffer();
    const svg = Buffer.from(
      `<svg width="${TILE_W}" height="${TILE_H}"><rect width="100%" height="100%" fill="#111"/>` +
        `<text x="10" y="128" fill="#7dd3fc" font-size="16" font-family="Consolas">${esc(lines[0])}</text>` +
        `<text x="10" y="150" fill="#fbbf24" font-size="16" font-family="Consolas">${esc(lines[1])}</text>` +
        `<text x="10" y="166" fill="#666" font-size="10" font-family="Arial">${k + 1}. ${esc(f.split("_").slice(0, 2).join("_"))} ${b.type}</text></svg>`,
    );
    const cols = 5, x = (k % cols) * TILE_W, y = Math.floor(k / cols) * TILE_H;
    tiles.push({ input: svg, left: x, top: y }, { input: thumb, left: x + 10, top: y + 8 });
    k++;
  }
}

const cols = 5, rows = Math.ceil(k / cols);
await sharp({ create: { width: cols * TILE_W, height: rows * TILE_H, channels: 3, background: "#000" } })
  .composite(tiles)
  .jpeg({ quality: 88 })
  .toFile(path.join(OUT, "ocr-sheet.jpg"));
fs.writeFileSync(path.join(OUT, "ocr-results.csv"), csv.join("\n"));
for (const name of Object.keys(models)) {
  const rowsM = csv.slice(1).filter((l) => l.split(",")[3] === name);
  const valid = rowsM.filter((l) => l.split(",")[7] === "true").length;
  const ms = rowsM.reduce((a, l) => a + Number(l.split(",").at(-1)), 0) / rowsM.length;
  console.log(`${name}: ${valid}/${rowsM.length} plates match the VN format, avg ${ms.toFixed(0)} ms per plate`);
}
console.log(`sheet: ${path.join(OUT, "ocr-sheet.jpg")} (${k} plates from ${files.length} images, mode=${mode})`);
