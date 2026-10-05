// Plate detection with plate.onnx (YOLO11 exported with nms=True -> output [1, 300, 6]) (docs 6.2)
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
