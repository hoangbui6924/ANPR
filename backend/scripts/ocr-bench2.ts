// Compare whole-pipeline configs (resize mode × single read vs vote) on the hand-read sample + extra real photos
//   node scripts/ocr-bench2.ts [extra.csv]   extra.csv: path,norm  (photos outside the dataset)
import fs from "node:fs";
import path from "node:path";
import ort from "onnxruntime-node";
import { decode, type Decoded, type ResizeMode } from "../src/recognition/image.ts";
import { detectPlates } from "../src/recognition/detect.ts";
import { loadOcr } from "../src/recognition/ocr.ts";
import { DEFAULT_VARIANTS, readBest, type ReadVariant } from "../src/recognition/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const dir = path.join(ROOT, "datasets/vn-plate/test/images");
const files = fs.readdirSync(dir);

const cases: { name: string; file: string; expected: string[] }[] = [];
for (const line of fs.readFileSync(path.join(import.meta.dirname, "gt-sample.csv"), "utf8").split(/\r?\n/).slice(1)) {
  const [key, norm] = line.split(",");
  if (!key || !norm) continue;
  const c = cases.find((x) => x.name === key);
  if (c) c.expected.push(norm);
  else cases.push({ name: key, file: path.join(dir, files.find((f) => f.startsWith(key + "_"))!), expected: [norm] });
}
const extraCsv = process.argv[2];
const extra: typeof cases = [];
if (extraCsv) {
  for (const line of fs.readFileSync(extraCsv, "utf8").split(/\r?\n/).slice(1)) {
    const [file, norm] = line.split(",");
    if (file && norm) extra.push({ name: path.basename(file), file: path.resolve(path.dirname(extraCsv), file), expected: [norm] });
  }
}

const det = await ort.InferenceSession.create(path.join(M, "plate.onnx"));
const ocr = await loadOcr(path.join(M, "rec_ch_v4_server.onnx"), path.join(M, "ppocr_keys_v1.txt"));
const configs: { name: string; mode: ResizeMode; variants: ReadVariant[] }[] = [
  { name: "stretch + gray (old default)", mode: "stretch", variants: [{ pad: 0.06, enhance: { gray: true } }] },
  { name: "letterbox + gray", mode: "letterbox", variants: [{ pad: 0.06, enhance: { gray: true } }] },
  { name: "letterbox + plain", mode: "letterbox", variants: [{ pad: 0.06, enhance: {} }] },
  { name: "stretch + vote", mode: "stretch", variants: DEFAULT_VARIANTS },
  { name: "letterbox + vote (new default)", mode: "letterbox", variants: DEFAULT_VARIANTS },
];

const images = new Map<string, Decoded>();
for (const c of [...cases, ...extra]) images.set(c.file, await decode(c.file));

async function score(list: typeof cases, cfg: (typeof configs)[number]) {
  let ok = 0, total = 0, ms = 0, n = 0;
  const miss: string[] = [];
  for (const c of list) {
    const img = images.get(c.file)!;
    const t0 = performance.now();
    const boxes = await detectPlates(det, img, { mode: cfg.mode });
    const got: string[] = [];
    for (const b of boxes) got.push((await readBest(ocr, img, b, cfg.variants)).norm);
    ms += performance.now() - t0;
    n++;
    for (const e of c.expected) {
      total++;
      const i = got.indexOf(e);
      if (i >= 0) { ok++; got.splice(i, 1); } else miss.push(`${c.name}:${e}→${got.join("|") || "∅"}`);
    }
  }
  return { ok, total, ms: ms / n, miss };
}

console.log("config                           sample(42)   extra   ms/image");
for (const cfg of configs) {
  const a = await score(cases, cfg);
  const b = extra.length ? await score(extra, cfg) : null;
  console.log(`${cfg.name.padEnd(32)} ${`${a.ok}/${a.total}`.padStart(8)}   ${b ? `${b.ok}/${b.total}`.padStart(5) : "  -  "}   ${a.ms.toFixed(0).padStart(6)}`);
  if (b?.miss.length) console.log(`   extra misses: ${b.miss.join("  ")}`);
}
