// Where do small plates fail? Per scale: detector hit rate, and OCR accuracy on the GROUND-TRUTH box
// (perfect detection), so detection and OCR errors are separated.
//   node scripts/diag-small.ts [ocrModel.onnx] [dict]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import ort from "onnxruntime-node";
import { decode } from "../src/recognition/image.ts";
import { detectPlates, type PlateBox } from "../src/recognition/detect.ts";
import { loadOcr, loadPlateOcr } from "../src/recognition/ocr.ts";
import { DEFAULT_VARIANTS, readBest } from "../src/recognition/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const dir = path.join(ROOT, "datasets/vn-plate/test");
const files = fs.readdirSync(path.join(dir, "images"));
const det = await ort.InferenceSession.create(path.join(M, "plate.onnx"));
const modelArg = process.argv[2] ?? "rec_ch_v4_server.onnx";
const load = (m: string, dict?: string) => (m.includes("plate_ocr") ? loadPlateOcr(path.join(M, m)) : loadOcr(path.join(M, m), path.join(M, dict ?? "ppocr_keys_v1.txt")));
// "a.onnx+b.onnx" = ensemble: both models vote together
const ocr = modelArg.includes("+") ? await Promise.all(modelArg.split("+").map((m) => load(m))) : await load(modelArg, process.argv[3]);

// GT: hand-read strings matched to label boxes by reading the full-size image with the GT box
const rows = fs.readFileSync(path.join(import.meta.dirname, "gt-sample.csv"), "utf8").split(/\r?\n/).slice(1).filter((l) => l.split(",")[1]);
const byKey = new Map<string, string[]>();
for (const l of rows) { const [k, n] = l.split(","); byKey.set(k, [...(byKey.get(k) ?? []), n]); }

type Item = { file: string; box: number[]; cls: number; expected: string[] };
const items: Item[] = [];
for (const [key, expected] of byKey) {
  const file = files.find((f) => f.startsWith(key + "_"))!;
  for (const l of fs.readFileSync(path.join(dir, "labels", file.replace(/\.jpg$/, ".txt")), "utf8").split("\n").filter((x) => x.trim())) {
    const [cls, ...v] = l.trim().split(/\s+/).map(Number);
    const xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2 === 1);
    items.push({ file, cls, expected, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
  }
}

console.log("scale  detector-hit  OCR-on-GT-box  (of plates that have a hand-read answer)");
for (const s of [1, 0.5, 0.35, 0.25]) {
  let hit = 0, ocrOk = 0, n = 0;
  const cache = new Map<string, { img: Awaited<ReturnType<typeof decode>>; boxes: PlateBox[] }>();
  for (const it of items) {
    if (!cache.has(it.file)) {
      const src = path.join(dir, "images", it.file);
      const buf = s === 1 ? fs.readFileSync(src) : await sharp(src).resize(Math.round(640 * s)).jpeg({ quality: 75 }).toBuffer();
      const img = await decode(buf);
      cache.set(it.file, { img, boxes: await detectPlates(det, img, { mode: "letterbox", minConf: 0.25 }) });
    }
    const { img, boxes } = cache.get(it.file)!;
    const gb: PlateBox = { x1: it.box[0] * img.width, y1: it.box[1] * img.height, x2: it.box[2] * img.width, y2: it.box[3] * img.height, conf: 1, type: it.cls === 0 ? "1line" : "2line" };
    const r = await readBest(ocr, img, gb, DEFAULT_VARIANTS);
    if (!it.expected.includes(r.norm) && s === 1) continue; // only plates whose GT string we can attribute
    n++;
    if (it.expected.includes(r.norm)) ocrOk++;
    if (boxes.some((b) => {
      const iw = Math.max(0, Math.min(gb.x2, b.x2) - Math.max(gb.x1, b.x1)), ih = Math.max(0, Math.min(gb.y2, b.y2) - Math.max(gb.y1, b.y1));
      return (iw * ih) / ((gb.x2 - gb.x1) * (gb.y2 - gb.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - iw * ih) >= 0.3;
    })) hit++;
  }
  console.log(`x${String(s).padEnd(5)} ${`${hit}/${n}`.padStart(9)}     ${`${ocrOk}/${n}`.padStart(9)}`);
}
