// Debug one image: compare detection resize modes, crop padding, OCR models and enhancement
//   node scripts/debug-plate.ts <image>
import path from "node:path";
import sharp from "sharp";
import ort from "onnxruntime-node";
import { decode } from "../src/recognition/image.ts";
import { detectPlates } from "../src/recognition/detect.ts";
import { crop, loadOcr, readLine, enhance } from "../src/recognition/ocr.ts";

const M = path.join(import.meta.dirname, "../models");
const img = await decode(process.argv[2]);
console.log(`image ${img.width}x${img.height}`);
const det = await ort.InferenceSession.create(path.join(M, "plate.onnx"));
const models = {
  en_v3: await loadOcr(path.join(M, "rec_en_v3.onnx"), path.join(M, "en_dict.txt")),
  ch_v4: await loadOcr(path.join(M, "rec_ch_v4.onnx"), path.join(M, "ppocr_keys_v1.txt")),
  server: await loadOcr(path.join(M, "rec_ch_v4_server.onnx"), path.join(M, "ppocr_keys_v1.txt")),
};
for (const mode of ["stretch", "letterbox"] as const) {
  const boxes = await detectPlates(det, img, { mode, minConf: 0.2 });
  for (const b of boxes) {
    console.log(`\n[${mode}] box ${[b.x1, b.y1, b.x2, b.y2].map(Math.round)} conf ${b.conf.toFixed(3)} ${b.type}  (${Math.round(b.x2 - b.x1)}x${Math.round(b.y2 - b.y1)} px)`);
    for (const pad of [0, 0.06, 0.15]) {
      const c = await crop(img, b, pad);
      await sharp(c.data, { raw: { width: c.width, height: c.height, channels: 3 } }).resize({ height: 120 }).png().toFile(path.join(import.meta.dirname, "out", `debug-${mode}-${pad}.png`));
      const row: string[] = [];
      for (const [name, m] of Object.entries(models)) {
        for (const [ename, e] of Object.entries({ plain: {}, gray: { gray: true } })) {
          const ec = await enhance(c, e);
          const r = await readLine(m, ec.data, ec.width, ec.height);
          row.push(`${name}/${ename}="${r.text}"(${r.conf.toFixed(2)})`);
        }
      }
      console.log(`  pad ${pad}: ${row.join("  ")}`);
    }
  }
}
