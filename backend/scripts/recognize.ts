// Quick CLI: recognize plates in one image or a whole folder
//   node scripts/recognize.ts <image-or-folder>
import fs from "node:fs";
import path from "node:path";
import { createRecognizer } from "../src/recognition/index.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/recognize.ts <image-or-folder>");
  process.exit(1);
}
const recognize = await createRecognizer({ modelsDir: path.join(import.meta.dirname, "../models") });
const files = fs.statSync(target).isDirectory()
  ? fs.readdirSync(target).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => path.join(target, f))
  : [target];

for (const f of files) {
  const r = await recognize(f);
  const plates = r.plates.map((p) => `${p.valid ? p.text : `${p.text} (cần kiểm tra)`} [${p.type}, det ${p.detConf}, ocr ${p.ocrConf}]`);
  console.log(`${path.basename(f)}  ${r.ms} ms  ${plates.join("  |  ") || "không thấy biển số"}`);
}
