// Plate detection with plate.onnx (YOLO11 exported with nms=True -> output [1, 300, 6]) (docs 6.2)
import sharp from "sharp";
import ort from "onnxruntime-node";
import { toTensor, type Decoded, type ResizeMode } from "./image.ts";

export type PlateType = "1line" | "2line";

export interface PlateBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  conf: number;
  type: PlateType;
}

export async function detectPlates(
  session: ort.InferenceSession,
  img: Decoded,
  { mode = "stretch" as ResizeMode, minConf = 0.4, size = 640 } = {},
): Promise<PlateBox[]> {
  const { tensor, map } = await toTensor(img, size, mode);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const d = out[session.outputNames[0]].data as Float32Array;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const plates: PlateBox[] = [];
  for (let i = 0; i < d.length; i += 6) {
    if (d[i + 4] < minConf) continue;
    plates.push({
      x1: clamp((d[i] - map.padX) / map.sx, img.width),
      y1: clamp((d[i + 1] - map.padY) / map.sy, img.height),
      x2: clamp((d[i + 2] - map.padX) / map.sx, img.width),
      y2: clamp((d[i + 3] - map.padY) / map.sy, img.height),
      conf: d[i + 4],
      type: d[i + 5] === 0 ? "1line" : "2line",
    });
  }
  return plates.sort((a, b) => b.conf - a.conf);
}

const area = (b: PlateBox) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const inter = (a: PlateBox, b: PlateBox) =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

/** Class-agnostic NMS; also drops a box mostly contained in a stronger one (tile edges cut plates in half) */
export function mergeBoxes(boxes: PlateBox[], iou = 0.45): PlateBox[] {
  const kept: PlateBox[] = [];
  for (const b of [...boxes].sort((a, c) => c.conf - a.conf)) {
    const dup = kept.some((k) => {
      const i = inter(k, b);
      return i / (area(k) + area(b) - i) > iou || i / Math.min(area(k), area(b)) > 0.7;
    });
    if (!dup) kept.push(b);
  }
  return kept;
}

/**
 * Detection on the full image + a 2×2 grid of overlapping tiles. Each tile is resized to the model input,
 * so small plates appear about twice as large to the detector (helps far-away / low-resolution plates).
 */
export async function detectPlatesTiled(
  session: ort.InferenceSession,
  img: Decoded,
  opts: { mode?: ResizeMode; minConf?: number; size?: number; overlap?: number } = {},
): Promise<PlateBox[]> {
  const all = await detectPlates(session, img, opts);
  const frac = 0.5 + (opts.overlap ?? 0.25) / 2;
  const tw = Math.round(img.width * frac), th = Math.round(img.height * frac);
  const src = sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });
  for (const x0 of [0, img.width - tw]) {
    for (const y0 of [0, img.height - th]) {
      const data = await src.clone().extract({ left: x0, top: y0, width: tw, height: th }).raw().toBuffer();
      for (const b of await detectPlates(session, { data, width: tw, height: th }, opts)) {
        all.push({ ...b, x1: b.x1 + x0, x2: b.x2 + x0, y1: b.y1 + y0, y2: b.y2 + y0 });
      }
    }
  }
  return mergeBoxes(all);
}
