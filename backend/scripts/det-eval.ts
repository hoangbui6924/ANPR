// Compare plate.onnx with "stretch" vs "letterbox" input on the test split, per source (docs 5.3, 6.2)
//   node scripts/det-eval.ts
import fs from "node:fs";
import path from "node:path";
import ort from "onnxruntime-node";
import { decode, type ResizeMode } from "../src/recognition/image.ts";
import { detectPlates, type PlateBox } from "../src/recognition/detect.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TEST = path.join(ROOT, "datasets/vn-plate/test");
const session = await ort.InferenceSession.create(path.join(import.meta.dirname, "../models/plate.onnx"));

type Gt = { x1: number; y1: number; x2: number; y2: number; cls: number };
function readGt(file: string, w: number, h: number): Gt[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const [cls, ...v] = l.trim().split(/\s+/).map(Number);
      const xs = v.filter((_, i) => i % 2 === 0).map((x) => x * w), ys = v.filter((_, i) => i % 2 === 1).map((y) => y * h);
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys), cls };
    });
}
const iou = (a: Gt | PlateBox, b: Gt | PlateBox) => {
  const iw = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)), ih = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = iw * ih;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
};

const images = fs.readdirSync(path.join(TEST, "images")).sort();
const stats: Record<string, Record<string, { tp: number; fp: number; fn: number; clsOk: number; ms: number; n: number }>> = {};

for (const mode of ["stretch", "letterbox"] as ResizeMode[]) {
  for (const f of images) {
    const src = f.split("_")[0];
    const img = await decode(path.join(TEST, "images", f));
    const gt = readGt(path.join(TEST, "labels", f.replace(/\.jpg$/, ".txt")), img.width, img.height);
    const t0 = performance.now();
    const pred = await detectPlates(session, img, { mode });
    const ms = performance.now() - t0;
    const s = ((stats[mode] ??= {})[src] ??= { tp: 0, fp: 0, fn: 0, clsOk: 0, ms: 0, n: 0 });
    const used = new Set<number>();
    for (const g of gt) {
      let best = -1, bestIou = 0.5;
      pred.forEach((p, i) => {
        const v = iou(g, p);
        if (!used.has(i) && v >= bestIou) { bestIou = v; best = i; }
      });
      if (best >= 0) {
        used.add(best);
        s.tp++;
        if ((pred[best].type === "1line" ? 0 : 1) === g.cls) s.clsOk++;
      } else s.fn++;
    }
    s.fp += pred.length - used.size;
    s.ms += ms;
    s.n++;
  }
}

for (const [mode, bySrc] of Object.entries(stats)) {
  console.log(`\n== ${mode}`);
  console.log("source      images  precision  recall  type-correct  avg ms");
  const all = { tp: 0, fp: 0, fn: 0, clsOk: 0, ms: 0, n: 0 };
  for (const [src, s] of Object.entries(bySrc).sort()) {
    for (const k of Object.keys(all) as (keyof typeof all)[]) all[k] += s[k];
    row(src, s);
  }
  row("ALL", all);
}
function row(name: string, s: { tp: number; fp: number; fn: number; clsOk: number; ms: number; n: number }) {
  const p = s.tp / (s.tp + s.fp || 1), r = s.tp / (s.tp + s.fn || 1);
  console.log(`${name.padEnd(11)} ${String(s.n).padStart(6)}  ${(p * 100).toFixed(1).padStart(8)}%  ${(r * 100).toFixed(1).padStart(5)}%  ${((s.clsOk / (s.tp || 1)) * 100).toFixed(1).padStart(11)}%  ${(s.ms / s.n).toFixed(0).padStart(6)}`);
}
