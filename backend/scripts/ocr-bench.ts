// Accuracy of OCR models × plate enhancement on the hand-read sample (scripts/gt-sample.csv).
// A plate counts as correct only when the whole normalized string matches.
//   node scripts/ocr-bench.ts
import fs from "node:fs";
import path from "node:path";
import ort from "onnxruntime-node";
import { decode, type Decoded } from "../src/recognition/image.ts";
import { detectPlates, type PlateBox } from "../src/recognition/detect.ts";
import { loadOcr, readPlate, type Enhance, type OcrModel } from "../src/recognition/ocr.ts";
import { postprocess } from "../src/recognition/postprocess.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const dir = path.join(ROOT, "datasets/vn-plate/test/images");

const gt = new Map<string, string[]>();
for (const line of fs.readFileSync(path.join(import.meta.dirname, "gt-sample.csv"), "utf8").split(/\r?\n/).slice(1)) {
  const [file, norm] = line.split(",");
  if (file && norm) gt.set(file, [...(gt.get(file) ?? []), norm]);
}
const total = [...gt.values()].reduce((a, v) => a + v.length, 0);

const det = await ort.InferenceSession.create(path.join(M, "plate.onnx"));
const models: Record<string, OcrModel> = {
  ch_v4: await loadOcr(path.join(M, "rec_ch_v4.onnx"), path.join(M, "ppocr_keys_v1.txt")),
  ch_v4_server: await loadOcr(path.join(M, "rec_ch_v4_server.onnx"), path.join(M, "ppocr_keys_v1.txt")),
};
const variants: Record<string, Enhance> = {
  none: {},
  gray: { gray: true },
  normalise: { contrast: "normalise" },
  clahe: { contrast: "clahe" },
  sharpen: { sharpen: true },
  deskew: { deskew: true },
  "deskew+gray+normalise": { deskew: true, gray: true, contrast: "normalise" },
  "deskew+clahe": { deskew: true, contrast: "clahe" },
};

// detect once
const files = fs.readdirSync(dir);
const samples: { key: string; img: Decoded; boxes: PlateBox[] }[] = [];
for (const key of gt.keys()) {
  const f = files.find((x) => x.startsWith(key + "_"))!;
  const img = await decode(path.join(dir, f));
  samples.push({ key, img, boxes: await detectPlates(det, img) });
}

console.log(`${total} plates in ${gt.size} images\n`);
console.log("model          variant                  correct   ms/plate");
const misses: Record<string, string[]> = {};
for (const [mName, model] of Object.entries(models)) {
  for (const [vName, opt] of Object.entries(variants)) {
    let ok = 0, ms = 0, n = 0;
    const miss: string[] = [];
    for (const s of samples) {
      const expected = [...gt.get(s.key)!];
      const got: string[] = [];
      for (const b of s.boxes) {
        const t0 = performance.now();
        const r = await readPlate(model, s.img, b, opt);
        ms += performance.now() - t0;
        n++;
        got.push(postprocess(r.rows).norm);
      }
      for (const e of expected) {
        const i = got.indexOf(e);
        if (i >= 0) { ok++; got.splice(i, 1); } else miss.push(`${s.key}:${e}→${got.join("|") || "∅"}`);
      }
    }
    misses[`${mName} ${vName}`] = miss;
    console.log(`${mName.padEnd(14)} ${vName.padEnd(24)} ${String(ok).padStart(3)}/${total} ${((ok / total) * 100).toFixed(0).padStart(4)}%  ${(ms / n).toFixed(0).padStart(6)}`);
  }
}
fs.mkdirSync(path.join(import.meta.dirname, "out"), { recursive: true });
fs.writeFileSync(path.join(import.meta.dirname, "out", "ocr-bench-misses.json"), JSON.stringify(misses, null, 1));
