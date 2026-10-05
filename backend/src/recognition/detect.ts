// Plate detection (docs 6.2). Two exported model kinds, both with nms=True:
//  - plate.onnx       (YOLO11 detect) -> [1, 300, 6]  x1 y1 x2 y2 conf cls
//  - plate_pose.onnx  (YOLO11-pose)   -> [1, 300, 18] ... + 4 corners (x, y, visibility), docs 5.5
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
  /** plate corners from the pose model: top-left, top-right, bottom-right, bottom-left */
  corners?: [number, number][];
}

export async function detectPlates(
  session: ort.InferenceSession,
  img: Decoded,
  { mode = "stretch" as ResizeMode, minConf = 0.4, size = 640 } = {},
): Promise<PlateBox[]> {
  const { tensor, map } = await toTensor(img, size, mode);
  const out = await session.run({ [session.inputNames[0]]: tensor });
  const o = out[session.outputNames[0]];
  const d = o.data as Float32Array;
  const stride = (o.dims as number[]).at(-1)!; // 6 (detect) or 18 (pose, 4 keypoints)
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const mx = (v: number) => clamp((v - map.padX) / map.sx, img.width);
  const my = (v: number) => clamp((v - map.padY) / map.sy, img.height);
  const plates: PlateBox[] = [];
  for (let i = 0; i < d.length; i += stride) {
    if (d[i + 4] < minConf) continue;
    const b: PlateBox = { x1: mx(d[i]), y1: my(d[i + 1]), x2: mx(d[i + 2]), y2: my(d[i + 3]), conf: d[i + 4], type: d[i + 5] === 0 ? "1line" : "2line" };
    if (stride >= 18) b.corners = [0, 1, 2, 3].map((k) => [mx(d[i + 6 + k * 3]), my(d[i + 7 + k * 3])] as [number, number]);
    plates.push(b);
  }
  return plates.sort((a, b) => b.conf - a.conf);
}

const area = (b: PlateBox) => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
const inter = (a: PlateBox, b: PlateBox) =>
  Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

const same = (a: PlateBox, b: PlateBox, iou: number) => {
  const i = inter(a, b);
  return i / (area(a) + area(b) - i) > iou || i / Math.min(area(a), area(b)) > 0.7;
};

/** A plate seen one or more times (full image / tiles). `box` is the most confident sighting. */
export interface PlateGroup {
  box: PlateBox;
  members: PlateBox[]; // all sightings, most confident first
}

/** Class-agnostic grouping: overlapping boxes, or one mostly inside another (cut by a tile edge), are the same plate */
export function groupBoxes(boxes: PlateBox[], iou = 0.45): PlateGroup[] {
  const groups: PlateGroup[] = [];
  for (const b of [...boxes].sort((a, c) => c.conf - a.conf)) {
    const g = groups.find((x) => same(x.box, b, iou));
    if (g) g.members.push(b);
    else groups.push({ box: b, members: [b] });
  }
  return groups;
}

export function mergeBoxes(boxes: PlateBox[], iou = 0.45): PlateBox[] {
  return groupBoxes(boxes, iou).map((g) => g.box);
}

/**
 * Detection on the full image + a 2×2 grid of overlapping tiles. Each tile is resized to the model input,
 * so small plates appear about twice as large to the detector (helps far-away / low-resolution plates).
 */
export async function detectPlatesTiled(
  session: ort.InferenceSession,
  img: Decoded,
  opts: { mode?: ResizeMode; minConf?: number; size?: number; overlap?: number } = {},
): Promise<PlateGroup[]> {
  const all = await detectPlates(session, img, opts);
  const frac = 0.5 + (opts.overlap ?? 0.25) / 2;
  const tw = Math.round(img.width * frac), th = Math.round(img.height * frac);
  const src = sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } });
  for (const x0 of [0, img.width - tw]) {
    for (const y0 of [0, img.height - th]) {
      const data = await src.clone().extract({ left: x0, top: y0, width: tw, height: th }).raw().toBuffer();
      for (const b of await detectPlates(session, { data, width: tw, height: th }, opts)) {
        all.push({ ...b, x1: b.x1 + x0, x2: b.x2 + x0, y1: b.y1 + y0, y2: b.y2 + y0, corners: b.corners?.map(([x, y]) => [x + x0, y + y0] as [number, number]) });
      }
    }
  }
  return groupBoxes(all);
}
