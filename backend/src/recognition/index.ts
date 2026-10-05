// Recognition entry point: image -> plates (shape of docs 8.2 "plates" items).
// Sessions are created ONCE at server start and reused for every request (docs 6.5).
import path from "node:path";
import ort from "onnxruntime-node";
import { decode, type Decoded, type ResizeMode } from "./image.ts";
import { detectPlates, detectPlatesTiled, type PlateBox, type PlateType } from "./detect.ts";
import { loadOcr, readPlate, type Enhance, type OcrModel } from "./ocr.ts";
import { postprocess, type PlateText, type Vehicle } from "./postprocess.ts";

export interface RecognizedPlate {
  text: string; // 51F-155.85 (or the raw reading when it does not match the VN format)
  norm: string; // 51F15585
  type: PlateType;
  vehicle: Vehicle | null;
  detConf: number;
  ocrConf: number;
  valid: boolean;
  bbox: [number, number, number, number];
}

/** One way of cropping / enhancing a plate before OCR */
export interface ReadVariant {
  pad: number; // crop widening on each side, fraction of the box size
  enhance: Enhance;
}

/**
 * Small plates give unstable readings: one more pixel of margin or a grayscale pass can drop a character.
 * Reading each plate a few ways and voting makes a single bad read harmless.
 */
export const DEFAULT_VARIANTS: ReadVariant[] = [
  { pad: 0.02, enhance: {} },
  { pad: 0.06, enhance: {} },
  { pad: 0.02, enhance: { gray: true } },
  { pad: 0.06, enhance: { gray: true } },
];

/** Extra readings for small plates (text rows below `smallRowPx`): enlarged + sharpened crops */
export const SMALL_VARIANTS: ReadVariant[] = [
  { pad: 0.04, enhance: { upscale: 64 } },
  { pad: 0.04, enhance: { upscale: 64, gray: true } },
  { pad: 0.04, enhance: { upscale: 64, contrast: "clahe" } },
];

/**
 * Majority vote over valid readings (ties -> higher confidence); falls back to the most confident reading.
 * Several OCR models can vote together (e.g. PaddleOCR + our plate OCR): all their readings go in one ballot.
 */
export async function readBest(ocr: OcrModel | OcrModel[], img: Decoded, box: PlateBox, variants: ReadVariant[]) {
  const reads: (PlateText & { conf: number; raw: string })[] = [];
  for (const m of Array.isArray(ocr) ? ocr : [ocr]) {
    for (const v of variants) {
      const r = await readPlate(m, img, box, v.enhance, v.pad);
      reads.push({ ...postprocess(r.rows), conf: r.conf, raw: r.raw });
    }
  }
  const valid = reads.filter((r) => r.valid);
  if (!valid.length) return reads.reduce((a, b) => (b.conf > a.conf ? b : a));
  const votes = new Map<string, { n: number; conf: number; read: (typeof reads)[number] }>();
  for (const r of valid) {
    const v = votes.get(r.norm) ?? { n: 0, conf: 0, read: r };
    v.n++;
    v.conf += r.conf;
    if (r.conf > v.read.conf) v.read = r;
    votes.set(r.norm, v);
  }
  const best = [...votes.values()].sort((a, b) => b.n - a.n || b.conf / b.n - a.conf / a.n)[0];
  return { ...best.read, conf: best.conf / best.n };
}

export interface RecognizerOptions {
  modelsDir: string;
  ocrModel?: string; // PaddleOCR rec model (ONNX)
  ocrDict?: string;
  resize?: ResizeMode;
  minDetConf?: number; // boxes above this are always reported
  lowDetConf?: number; // boxes between lowDetConf and minDetConf are kept only if they read as a valid VN plate
  tiles?: "off" | "auto" | "always"; // auto: tile pass only when the full image gives no confident plate
  variants?: ReadVariant[];
  smallVariants?: ReadVariant[];
  smallRowPx?: number;
}

/** Defaults chosen with scripts/ocr-bench2.ts + scripts/small-bench.ts */
export async function createRecognizer({
  modelsDir,
  ocrModel = "rec_ch_v4_server.onnx",
  ocrDict = "ppocr_keys_v1.txt",
  resize = "letterbox",
  minDetConf = 0.4,
  lowDetConf = 0.4,
  tiles = "off",
  variants = DEFAULT_VARIANTS,
  smallVariants = [],
  smallRowPx = 28,
}: RecognizerOptions) {
  const det = await ort.InferenceSession.create(path.join(modelsDir, "plate.onnx"));
  const ocr: OcrModel = await loadOcr(path.join(modelsDir, ocrModel), path.join(modelsDir, ocrDict));

  return async function recognize(image: Buffer | string): Promise<{ plates: RecognizedPlate[]; width: number; height: number; ms: number }> {
    const t0 = performance.now();
    const img = await decode(image);
    const detOpts = { mode: resize, minConf: Math.min(minDetConf, lowDetConf) };
    let boxes = await detectPlates(det, img, detOpts);
    if (tiles === "always" || (tiles === "auto" && !boxes.some((b) => b.conf >= minDetConf))) {
      boxes = await detectPlatesTiled(det, img, detOpts);
    }
    const plates: RecognizedPlate[] = [];
    for (const b of boxes) {
      const rowPx = (b.y2 - b.y1) / (b.type === "2line" ? 2 : 1);
      const r = await readBest(ocr, img, b, rowPx < smallRowPx ? [...variants, ...smallVariants] : variants);
      if (b.conf < minDetConf && !r.valid) continue; // weak box that does not read as a plate: likely a false detection
      plates.push({
        text: r.valid ? r.text : r.raw,
        norm: r.norm,
        type: b.type,
        vehicle: r.vehicle,
        detConf: +b.conf.toFixed(3),
        ocrConf: +r.conf.toFixed(3),
        valid: r.valid,
        bbox: [b.x1, b.y1, b.x2, b.y2].map(Math.round) as RecognizedPlate["bbox"],
      });
    }
    return { plates, width: img.width, height: img.height, ms: Math.round(performance.now() - t0) };
  };
}

export type Recognizer = Awaited<ReturnType<typeof createRecognizer>>;
