// Recognition entry point: image -> plates (shape of docs 8.2 "plates" items).
// Sessions are created ONCE at server start and reused for every request (docs 6.5).
import path from "node:path";
import ort from "onnxruntime-node";
import { decode, type ResizeMode } from "./image.ts";
import { detectPlates, type PlateType } from "./detect.ts";
import { loadOcr, readPlate, type Enhance, type OcrModel } from "./ocr.ts";
import { postprocess, type Vehicle } from "./postprocess.ts";

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

export interface RecognizerOptions {
  modelsDir: string;
  ocrModel?: string; // PaddleOCR rec model (ONNX)
  ocrDict?: string;
  resize?: ResizeMode;
  minDetConf?: number;
  enhance?: Enhance;
}

/** Defaults chosen with scripts/ocr-bench.ts: PP-OCRv4 server rec + grayscale (best on the hand-read sample) */
export async function createRecognizer({
  modelsDir,
  ocrModel = "rec_ch_v4_server.onnx",
  ocrDict = "ppocr_keys_v1.txt",
  resize = "stretch",
  minDetConf = 0.4,
  enhance = { gray: true },
}: RecognizerOptions) {
  const det = await ort.InferenceSession.create(path.join(modelsDir, "plate.onnx"));
  const ocr: OcrModel = await loadOcr(path.join(modelsDir, ocrModel), path.join(modelsDir, ocrDict));

  return async function recognize(image: Buffer | string): Promise<{ plates: RecognizedPlate[]; width: number; height: number; ms: number }> {
    const t0 = performance.now();
    const img = await decode(image);
    const boxes = await detectPlates(det, img, { mode: resize, minConf: minDetConf });
    const plates: RecognizedPlate[] = [];
    for (const b of boxes) {
      const r = await readPlate(ocr, img, b, enhance);
      const p = postprocess(r.rows);
      plates.push({
        text: p.valid ? p.text : r.raw,
        norm: p.norm,
        type: b.type,
        vehicle: p.vehicle,
        detConf: +b.conf.toFixed(3),
        ocrConf: +r.conf.toFixed(3),
        valid: p.valid,
        bbox: [b.x1, b.y1, b.x2, b.y2].map(Math.round) as RecognizedPlate["bbox"],
      });
    }
    return { plates, width: img.width, height: img.height, ms: Math.round(performance.now() - t0) };
  };
}

export type Recognizer = Awaited<ReturnType<typeof createRecognizer>>;
