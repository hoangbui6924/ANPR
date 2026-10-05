// Build a plate-text dataset for training a dedicated plate OCR model.
// For every plate box in the train/valid labels: crop at full resolution, read it with two strong PaddleOCR
// models (multi-variant vote each) and keep it only when both agree on a valid VN plate. 2-line plates are
// split into their rows exactly like at inference time. Output: datasets/vn-plate-ocr/<split>/rows/*.png + labels.csv
//   node scripts/pseudo-label.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { decode } from "../src/recognition/image.ts";
import type { PlateBox } from "../src/recognition/detect.ts";
import { crop, loadOcr, plateRows } from "../src/recognition/ocr.ts";
import { DEFAULT_VARIANTS, readBest } from "../src/recognition/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const SRC = path.join(ROOT, "datasets/vn-plate");
const OUT = path.join(ROOT, "datasets/vn-plate-ocr");

const a = await loadOcr(path.join(M, "rec_ch_v4_server.onnx"), path.join(M, "ppocr_keys_v1.txt"));
const b = await loadOcr(path.join(M, "zoo/PP-OCRv6_medium_rec/inference.onnx"), path.join(M, "zoo/PP-OCRv6_medium_rec/dict.txt"));

/** "59-V2 453.87" -> ["59V2", "45387"], "29A-680.05" (2-line) -> ["29A", "68005"] */
function rowLabels(text: string, norm: string, type: "1line" | "2line"): string[] {
  if (type === "1line") return [norm];
  const top = (text.includes(" ") ? text.split(" ")[0] : text.split("-")[0]).replace(/[^0-9A-Z]/g, "");
  return [top, norm.slice(top.length)];
}

for (const split of ["train", "valid"]) {
  const imgDir = path.join(SRC, split, "images");
  const rowDir = path.join(OUT, split, "rows");
  fs.mkdirSync(rowDir, { recursive: true });
  const csv = ["file,label,plate_type,plate_norm,source"];
  let plates = 0, kept = 0, disagree = 0, invalid = 0;
  const files = fs.readdirSync(imgDir).sort();
  const t0 = performance.now();
  for (const [fi, f] of files.entries()) {
    const img = await decode(path.join(imgDir, f));
    const labels = fs.readFileSync(path.join(SRC, split, "labels", f.replace(/\.jpg$/, ".txt")), "utf8").split("\n").filter((l) => l.trim());
    for (const [li, l] of labels.entries()) {
      const [cls, ...v] = l.trim().split(/\s+/).map(Number);
      const xs = v.filter((_, i) => i % 2 === 0).map((x) => x * img.width), ys = v.filter((_, i) => i % 2 === 1).map((y) => y * img.height);
      const box: PlateBox = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys), conf: 1, type: cls === 0 ? "1line" : "2line" };
      if (box.x2 - box.x1 < 12 || box.y2 - box.y1 < 8) continue;
      plates++;
      const ra = await readBest(a, img, box, DEFAULT_VARIANTS);
      if (!ra.valid) { invalid++; continue; }
      const rb = await readBest(b, img, box, DEFAULT_VARIANTS);
      if (!rb.valid || rb.norm !== ra.norm) { disagree++; continue; }
      const labelsRows = rowLabels(ra.text, ra.norm, box.type);
      const c = await crop(img, box, 0.04);
      const rows = await plateRows(c, box.type);
      if (rows.length !== labelsRows.length || labelsRows.some((x) => !x)) continue;
      for (const [ri, r] of rows.entries()) {
        const name = `${f.replace(/\.jpg$/, "")}_${li}_${ri}.png`;
        await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } }).png().toFile(path.join(rowDir, name));
        csv.push([name, labelsRows[ri], box.type, ra.norm, f.split("_")[0]].join(","));
      }
      kept++;
    }
    if ((fi + 1) % 200 === 0) {
      const el = (performance.now() - t0) / 1000;
      console.log(`${split} ${fi + 1}/${files.length} images, kept ${kept}/${plates} plates, ${el.toFixed(0)}s, eta ${((el / (fi + 1)) * (files.length - fi - 1) / 60).toFixed(1)} min`);
    }
  }
  fs.writeFileSync(path.join(OUT, split, "labels.csv"), csv.join("\n") + "\n");
  console.log(`${split}: ${plates} plates -> kept ${kept} (${((kept / plates) * 100).toFixed(1)}%), invalid ${invalid}, models disagree ${disagree}, rows ${csv.length - 1}`);
}
