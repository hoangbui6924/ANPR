// Character reading with a CTC text-recognition model (ONNX): PaddleOCR rec models, or our own plate OCR
// (training/train_plate_ocr.py). The model reads ONE text line, so a 2-line plate is split into its two rows first.
import fs from "node:fs";
import sharp from "sharp";
import ort from "onnxruntime-node";
import type { Decoded } from "./image.ts";
import type { PlateBox } from "./detect.ts";

export interface OcrModel {
  session: ort.InferenceSession;
  chars: string[]; // index 0 = CTC blank
  /** "paddle": BGR, height 48, free width. "plate": gray, height 32, right-padded to a fixed width */
  input: { kind: "paddle" } | { kind: "plate"; height: number; width: number };
}

/** PaddleOCR label list: blank + dictionary lines (+ space when the model was trained with use_space_char) */
export async function loadOcr(modelPath: string, dictPath: string): Promise<OcrModel> {
  const session = await ort.InferenceSession.create(modelPath);
  const dict = fs.readFileSync(dictPath, "utf8").split(/\r?\n/).filter((l, i, a) => l !== "" || i < a.length - 1);
  return { session, chars: ["", ...dict, " "], input: { kind: "paddle" } };
}

/** Our plate OCR: <name>.onnx + <name>.json (charset, input size) written by training/train_plate_ocr.py */
export async function loadPlateOcr(modelPath: string): Promise<OcrModel> {
  const meta = JSON.parse(fs.readFileSync(modelPath.replace(/.onnx$/, ".json"), "utf8")) as { charset: string; height: number; width: number };
  const session = await ort.InferenceSession.create(modelPath);
  return { session, chars: ["", ...meta.charset], input: { kind: "plate", height: meta.height, width: meta.width } };
}

/** Gray, resize to height H keeping ratio (max width W), [-1, 1], zero right-pad (mirrors train_plate_ocr.preprocess) */
async function plateTensor(rgb: Buffer, w: number, h: number, H: number, W: number): Promise<ort.Tensor> {
  const nw = Math.max(1, Math.min(W, Math.round((w * H) / h)));
  const g = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .grayscale()
    .resize(nw, H, { fit: "fill", kernel: h > H ? "mitchell" : "cubic" })
    .raw()
    .toBuffer();
  const f = new Float32Array(H * W);
  for (let y = 0; y < H; y++) for (let x = 0; x < nw; x++) f[y * W + x] = (g[y * nw + x] / 255 - 0.5) / 0.5;
  return new ort.Tensor("float32", f, [1, 1, H, W]);
}

const REC_H = 48;

/** Resize a line crop to height 48 and normalize to [-1, 1] (PaddleOCR rec preprocessing) */
async function lineTensor(rgb: Buffer, w: number, h: number): Promise<ort.Tensor> {
  const outW = Math.max(REC_H, Math.min(Math.ceil((REC_H * w) / h), 640));
  const data = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } })
    .resize(outW, REC_H, { fit: "fill" })
    .raw()
    .toBuffer();
  const area = outW * REC_H, f = new Float32Array(3 * area);
  // Paddle models take BGR
  for (let i = 0; i < area; i++) {
    f[i] = (data[i * 3 + 2] / 255 - 0.5) / 0.5;
    f[i + area] = (data[i * 3 + 1] / 255 - 0.5) / 0.5;
    f[i + 2 * area] = (data[i * 3] / 255 - 0.5) / 0.5;
  }
  return new ort.Tensor("float32", f, [1, 3, REC_H, outW]);
}

/** Greedy CTC: argmax per step, merge repeats, drop blanks */
function ctcDecode(probs: Float32Array, steps: number, classes: number, chars: string[]) {
  let text = "", last = 0, confSum = 0, n = 0;
  for (let t = 0; t < steps; t++) {
    let best = 0, bestP = -1;
    for (let c = 0; c < classes; c++) {
      const p = probs[t * classes + c];
      if (p > bestP) { bestP = p; best = c; }
    }
    if (best !== 0 && best !== last) {
      text += chars[best] ?? "";
      confSum += bestP;
      n++;
    }
    last = best;
  }
  return { text, conf: n ? confSum / n : 0 };
}

export async function readLine(model: OcrModel, rgb: Buffer, w: number, h: number) {
  const tensor = model.input.kind === "plate" ? await plateTensor(rgb, w, h, model.input.height, model.input.width) : await lineTensor(rgb, w, h);
  const out = await model.session.run({ [model.session.inputNames[0]]: tensor });
  const o = out[model.session.outputNames[0]];
  const [, steps, classes] = o.dims as number[];
  return ctcDecode(o.data as Float32Array, steps, classes, model.chars);
}

/** Crop a box (expanded by `pad` of its size on each side) as raw RGB */
export async function crop(img: Decoded, b: PlateBox, pad = 0.06) {
  const bw = b.x2 - b.x1, bh = b.y2 - b.y1;
  const left = Math.max(0, Math.floor(b.x1 - bw * pad));
  const top = Math.max(0, Math.floor(b.y1 - bh * pad));
  const width = Math.min(img.width - left, Math.ceil(bw * (1 + 2 * pad)));
  const height = Math.min(img.height - top, Math.ceil(bh * (1 + 2 * pad)));
  const data = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .extract({ left, top, width, height })
    .raw()
    .toBuffer();
  return { data, width, height };
}

/** Row where the two text lines of a 2-line plate are separated: the brightest row near the middle */
function splitRow(rgb: Buffer, w: number, h: number): number {
  let bestRow = Math.round(h / 2), best = -1;
  for (let y = Math.floor(h * 0.35); y <= Math.ceil(h * 0.65); y++) {
    let sum = 0;
    for (let x = Math.floor(w * 0.1); x < w * 0.9; x++) {
      const i = (y * w + x) * 3;
      sum += rgb[i] + rgb[i + 1] + rgb[i + 2];
    }
    if (sum > best) { best = sum; bestRow = y; }
  }
  return bestRow;
}

async function rows(rgb: Buffer, w: number, h: number, cut: number) {
  const img = sharp(rgb, { raw: { width: w, height: h, channels: 3 } });
  const overlap = Math.round(h * 0.04);
  const topH = Math.min(h, cut + overlap), botY = Math.max(0, cut - overlap);
  return [
    { data: await img.clone().extract({ left: 0, top: 0, width: w, height: topH }).raw().toBuffer(), width: w, height: topH },
    { data: await img.clone().extract({ left: 0, top: botY, width: w, height: h - botY }).raw().toBuffer(), width: w, height: h - botY },
  ];
}

/** A plate crop as the OCR model sees it: one row, or the two rows of a 2-line plate */
export async function plateRows(c: { data: Buffer; width: number; height: number }, type: PlateBox["type"]) {
  return type === "2line" ? rows(c.data, c.width, c.height, splitRow(c.data, c.width, c.height)) : [c];
}

// ---------- plate enhancement before OCR ----------

export interface Enhance {
  gray?: boolean; // drop plate background colour (yellow / red / blue plates)
  contrast?: "none" | "normalise" | "clahe"; // global stretch or local (CLAHE) contrast
  sharpen?: boolean;
  deskew?: boolean; // rotate so the text rows are horizontal
  upscale?: number; // enlarge (lanczos3 + unsharp mask) so each text row is at least this many px tall
}

type Rgb = { data: Buffer; width: number; height: number };

/** Tilt angle (degrees) that makes dark text pixels line up in rows: maximise the row-projection variance */
async function estimateSkew(c: Rgb): Promise<number> {
  const W = 160, scale = W / c.width, H = Math.max(8, Math.round(c.height * scale));
  const g = await sharp(c.data, { raw: { width: c.width, height: c.height, channels: 3 } })
    .resize(W, H, { fit: "fill" })
    .grayscale()
    .normalise()
    .raw()
    .toBuffer();
  const pts: [number, number][] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y * W + x] < 90) pts.push([x - W / 2, y - H / 2]);
  if (pts.length < 20) return 0;
  let best = 0, bestScore = -1;
  for (let a = -15; a <= 15; a += 0.5) {
    const r = (a * Math.PI) / 180, sin = Math.sin(r), cos = Math.cos(r);
    const hist = new Float64Array(H * 2 + 4);
    for (const [x, y] of pts) hist[Math.round(y * cos - x * sin + H) | 0]++;
    let score = 0;
    for (const v of hist) score += v * v;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

export async function enhance(c: Rgb, opt: Enhance, rowsCount = 1): Promise<Rgb> {
  const up = opt.upscale ? (opt.upscale * rowsCount) / c.height : 1;
  if (!opt.gray && (!opt.contrast || opt.contrast === "none") && !opt.sharpen && !opt.deskew && up <= 1) return c;
  let s = sharp(c.data, { raw: { width: c.width, height: c.height, channels: 3 } });
  if (up > 1) {
    s = sharp(await s.resize(Math.round(c.width * up), Math.round(c.height * up), { kernel: "lanczos3" }).sharpen({ sigma: 1.2 }).png().toBuffer());
  }
  if (opt.deskew) {
    const angle = await estimateSkew(c);
    if (Math.abs(angle) >= 1) s = sharp(await s.rotate(-angle, { background: "#ffffff" }).png().toBuffer());
  }
  if (opt.gray) s = s.grayscale();
  if (opt.contrast === "normalise") s = s.normalise();
  if (opt.contrast === "clahe") s = s.clahe({ width: Math.max(8, Math.round(c.width / 4)), height: Math.max(8, Math.round(c.height / 2)), maxSlope: 3 });
  if (opt.sharpen) s = s.sharpen({ sigma: 1 });
  const { data, info } = await s.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 3) return { data, width: info.width, height: info.height };
  // grayscale comes back with 1 channel: expand to RGB for the rest of the pipeline
  const rgb = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0, n = info.width * info.height; i < n; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = data[i * info.channels];
  return { data: rgb, width: info.width, height: info.height };
}

/** Read a detected plate: text per row + mean confidence */
export async function readPlate(model: OcrModel, img: Decoded, box: PlateBox, opt: Enhance = {}, pad = 0.06) {
  const c = await enhance(await crop(img, box, pad), opt, box.type === "2line" ? 2 : 1);
  const lines = await plateRows(c, box.type);
  const parts = [];
  for (const l of lines) parts.push(await readLine(model, l.data, l.width, l.height));
  return {
    rows: parts.map((p) => p.text),
    raw: parts.map((p) => p.text).join(" "),
    conf: parts.reduce((a, p) => a + p.conf, 0) / parts.length,
    crop: c,
  };
}
