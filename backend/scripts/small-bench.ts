// Small-plate benchmark: the hand-read sample images are downscaled (and JPEG-compressed like web / CCTV images),
// so the same plates become small; whole-string accuracy is measured per scale and per pipeline config.
//   node scripts/small-bench.ts
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { decode, type Decoded } from "../src/recognition/image.ts";
import { createRecognizer, type RecognizerOptions } from "../src/recognition/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const dir = path.join(ROOT, "datasets/vn-plate/test");
const files = fs.readdirSync(path.join(dir, "images"));
const SCALES = [1, 0.5, 0.35, 0.25];

const cases: { key: string; file: string; expected: string[] }[] = [];
for (const line of fs.readFileSync(path.join(import.meta.dirname, "gt-sample.csv"), "utf8").split(/\r?\n/).slice(1)) {
  const [key, norm] = line.split(",");
  if (!key || !norm) continue;
  const c = cases.find((x) => x.key === key);
  if (c) c.expected.push(norm);
  else cases.push({ key, file: files.find((f) => f.startsWith(key + "_"))!, expected: [norm] });
}

// plate text height in pixels at each scale (from the label boxes; 2-line plates: per row)
const heights: number[] = [];
for (const c of cases) {
  for (const l of fs.readFileSync(path.join(dir, "labels", c.file.replace(/\.jpg$/, ".txt")), "utf8").split("\n").filter((x) => x.trim())) {
    const [cls, ...v] = l.trim().split(/\s+/).map(Number);
    const ys = v.filter((_, i) => i % 2 === 1);
    const h = (Math.max(...ys) - Math.min(...ys)) * 640;
    heights.push(cls === 1 ? h / 2 : h);
  }
}
heights.sort((a, b) => a - b);
const median = heights[Math.floor(heights.length / 2)];
console.log(`${cases.length} images, ${cases.reduce((a, c) => a + c.expected.length, 0)} plates`);
console.log("scale   text height per row (px): min / median");
for (const s of SCALES) console.log(`${String(s).padEnd(6)}  ${(heights[0] * s).toFixed(0).padStart(3)} / ${(median * s).toFixed(0)}`);

// pre-render the downscaled images once
const images = new Map<string, Buffer>();
for (const s of SCALES) {
  for (const c of cases) {
    const src = path.join(dir, "images", c.file);
    const buf = s === 1 ? fs.readFileSync(src) : await sharp(src).resize(Math.round(640 * s)).jpeg({ quality: 75 }).toBuffer();
    images.set(`${s}|${c.key}`, buf);
  }
}

const configs: Record<string, Partial<RecognizerOptions>> = JSON.parse(process.env.CONFIGS ?? "null") ?? {
  current: {},
};

console.log(`\nconfig                     ${SCALES.map((s) => `x${s}`.padStart(8)).join("")}    ms/img (x0.25)`);
for (const [name, opt] of Object.entries(configs)) {
  const recognize = await createRecognizer({ modelsDir: M, ...opt });
  const cells: string[] = [];
  let lastMs = 0;
  for (const s of SCALES) {
    let ok = 0, total = 0, ms = 0;
    for (const c of cases) {
      const r = await recognize(images.get(`${s}|${c.key}`)!);
      ms += r.ms;
      const got = r.plates.map((p) => p.norm);
      for (const e of c.expected) {
        total++;
        const i = got.indexOf(e);
        if (i >= 0) { ok++; got.splice(i, 1); }
      }
    }
    cells.push(`${ok}/${total}`.padStart(8));
    lastMs = ms / cases.length;
  }
  console.log(`${name.padEnd(26)} ${cells.join("")}    ${lastMs.toFixed(0)}`);
}
export type { Decoded };
void decode;
