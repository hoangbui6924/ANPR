// Whole-system accuracy on the human-verified test set (docs 4.6 / 11): detection + OCR + post-processing.
// Input: datasets/eval-200/answers.csv (downloaded from review.html) + prefill.csv (boxes).
//   node scripts/eval-200.ts [answers.csv]   -> prints tables and writes datasets/eval-200/report.md
import fs from "node:fs";
import path from "node:path";
import { createRecognizer } from "../src/recognition/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIR = path.join(ROOT, "datasets/eval-200");
const TEST = path.join(ROOT, "datasets/vn-plate/test/images");
const answersPath = process.argv[2] ?? path.join(DIR, "answers.csv");
if (!fs.existsSync(answersPath)) {
  console.error(`missing ${answersPath}: open datasets/eval-200/review.html, check the answers, download answers.csv`);
  process.exit(1);
}

const parse = (p: string) => fs.readFileSync(p, "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(","));
const prefill = new Map(parse(path.join(DIR, "prefill.csv")).map((r) => [r[0], { image: r[1], source: r[2], type: r[4], box: r.slice(5, 9).map(Number) }]));
type Gt = { id: string; image: string; source: string; type: string; box: number[]; answer: string };
const gts: Gt[] = [];
let unchecked = 0, skipped = 0;
for (const [id, answer, skip, checked] of parse(answersPath)) {
  const p = prefill.get(id);
  if (!p) continue;
  if (skip === "1") { skipped++; continue; }
  if (checked !== "1") unchecked++;
  if (answer) gts.push({ id, ...p, answer });
}
if (unchecked) console.warn(`warning: ${unchecked} answers were not marked as checked in review.html`);

const recognize = await createRecognizer({ modelsDir: path.join(import.meta.dirname, "../models") });
const byImage = new Map<string, Gt[]>();
for (const g of gts) byImage.set(g.image, [...(byImage.get(g.image) ?? []), g]);

type Acc = { plates: number; detected: number; correct: number; charOk: number; charTotal: number; extra: number };
const blank = (): Acc => ({ plates: 0, detected: 0, correct: 0, charOk: 0, charTotal: 0, extra: 0 });
const bySource: Record<string, Acc> = {}, byType: Record<string, Acc> = {}, all = blank();
const errors: string[] = [];
let ms = 0;

// character accuracy = 1 - edit distance / length (normalized strings)
const editDistance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

for (const [image, list] of byImage) {
  const r = await recognize(path.join(TEST, image));
  ms += r.ms;
  const used = new Set<number>();
  for (const g of list) {
    const gb = [g.box[0] * r.width, g.box[1] * r.height, g.box[2] * r.width, g.box[3] * r.height];
    let best = -1, bestIou = 0.3;
    r.plates.forEach((p, i) => {
      if (used.has(i)) return;
      const iw = Math.max(0, Math.min(gb[2], p.bbox[2]) - Math.max(gb[0], p.bbox[0])), ih = Math.max(0, Math.min(gb[3], p.bbox[3]) - Math.max(gb[1], p.bbox[1]));
      const iou = (iw * ih) / ((gb[2] - gb[0]) * (gb[3] - gb[1]) + (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1]) - iw * ih);
      if (iou >= bestIou) { bestIou = iou; best = i; }
    });
    const got = best >= 0 ? r.plates[best].norm : "";
    if (best >= 0) used.add(best);
    for (const a of [all, (bySource[g.source] ??= blank()), (byType[g.type] ??= blank())]) {
      a.plates++;
      if (best >= 0) a.detected++;
      if (got === g.answer) a.correct++;
      a.charTotal += g.answer.length;
      a.charOk += Math.max(0, g.answer.length - editDistance(got, g.answer));
    }
    if (got !== g.answer) errors.push(`${g.id}: expected ${g.answer}, got ${got || "(not detected)"}`);
  }
  const extra = r.plates.length - used.size;
  all.extra += extra;
  (bySource[list[0].source] ??= blank()).extra += extra;
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
const line = (name: string, a: Acc) => `| ${name} | ${a.plates} | ${pct(a.detected, a.plates)} | ${pct(a.correct, a.plates)} | ${pct(a.charOk, a.charTotal)} | ${a.extra} |`;
const head = "| | Biển | Phát hiện | Đọc đúng cả biển | Đúng theo ký tự | Khung thừa |\n|---|---|---|---|---|---|";
const report = [
  `# Kết quả kiểm thử toàn hệ thống (${byImage.size} ảnh, ${all.plates} biển)`,
  "",
  `Đáp án: ${path.basename(answersPath)} (${skipped} biển bị loại vì không đọc được bằng mắt${unchecked ? `, ${unchecked} đáp án chưa đánh dấu đã kiểm tra` : ""}). Thời gian trung bình ${Math.round(ms / byImage.size)} ms/ảnh (CPU).`,
  "",
  "## Theo nguồn",
  head,
  ...Object.entries(bySource).sort().map(([k, a]) => line(k, a)),
  line("**Tất cả**", all),
  "",
  "## Theo loại biển",
  head,
  ...Object.entries(byType).sort().map(([k, a]) => line(k === "1line" ? "Biển 1 dòng" : "Biển 2 dòng", a)),
  "",
  `## Các biển đọc sai (${errors.length})`,
  "",
  ...errors.map((e) => `- ${e}`),
].join("\n");
fs.writeFileSync(path.join(DIR, "report.md"), report + "\n");
console.log(report.split("## Các biển")[0]);
console.log(`errors: ${errors.length} (full list in datasets/eval-200/report.md)`);
