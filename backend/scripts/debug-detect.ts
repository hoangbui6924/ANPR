// Debug detection on one large image: full-image vs tiled detection at several confidence levels, with readings
//   node scripts/debug-detect.ts <image> [grid]
import path from "node:path";
import ort from "onnxruntime-node";
import { decode } from "../src/recognition/image.ts";
import { detectPlates, detectPlatesTiled, type PlateBox } from "../src/recognition/detect.ts";
import { loadOcr, loadPlateOcr } from "../src/recognition/ocr.ts";
import { DEFAULT_VARIANTS, readBest } from "../src/recognition/index.ts";

const M = path.join(import.meta.dirname, "../models");
const img = await decode(process.argv[2]);
console.log(`image ${img.width}x${img.height}`);
const det = await ort.InferenceSession.create(path.join(M, "plate.onnx"));
const ocr = [await loadOcr(path.join(M, "rec_ch_v4_server.onnx"), path.join(M, "ppocr_keys_v1.txt")), await loadPlateOcr(path.join(M, "plate_ocr_v2.onnx"))];

async function show(name: string, boxes: PlateBox[]) {
  console.log(`\n${name}: ${boxes.length} boxes`);
  for (const b of boxes) {
    const r = await readBest(ocr, img, b, DEFAULT_VARIANTS);
    console.log(`  conf ${b.conf.toFixed(2)} ${b.type} ${Math.round(b.x2 - b.x1)}x${Math.round(b.y2 - b.y1)}px at ${Math.round(b.x1)},${Math.round(b.y1)}  -> ${r.valid ? r.text : r.raw + " (invalid)"}`);
  }
}
const t0 = performance.now();
await show("full image, conf>=0.4", await detectPlates(det, img, { mode: "letterbox", minConf: 0.4 }));
await show("full image, conf>=0.15", await detectPlates(det, img, { mode: "letterbox", minConf: 0.15 }));
const t1 = performance.now();
await show("tiled 2x2, conf>=0.25", (await detectPlatesTiled(det, img, { mode: "letterbox", minConf: 0.25 })).map((g) => g.box));
console.log(`\n(full ${Math.round(t1 - t0)} ms incl. OCR, tiled ${Math.round(performance.now() - t1)} ms incl. OCR)`);
