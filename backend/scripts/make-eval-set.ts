// Build the ~200-image system test set (docs 4.6): pick test images per source, crop every labelled plate,
// pre-fill the answer with the current OCR, and write review.html where a person checks / corrects each answer
// and downloads answers.csv. The pre-filled text is only a starting point: the answer key must be human-verified.
//   node scripts/make-eval-set.ts   -> datasets/eval-200/{review.html, crops/, prefill.csv}
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { decode } from "../src/recognition/image.ts";
import type { PlateBox } from "../src/recognition/detect.ts";
import { crop, loadOcr, loadPlateOcr } from "../src/recognition/ocr.ts";
import { DEFAULT_VARIANTS, readBest } from "../src/recognition/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const M = path.join(import.meta.dirname, "../models");
const TEST = path.join(ROOT, "datasets/vn-plate/test");
const OUT = path.join(ROOT, "datasets/eval-200");
const PER_SOURCE: Record<string, number> = { greenpack: 77, carlong: 43, Tgmt: 39, Dieu: 22, Hung: 19 }; // = 200, ~44% of each source

const ocr = [await loadOcr(path.join(M, "rec_ch_v4_server.onnx"), path.join(M, "ppocr_keys_v1.txt")), await loadPlateOcr(path.join(M, "plate_ocr_v2.onnx"))];
fs.mkdirSync(path.join(OUT, "crops"), { recursive: true });

const all = fs.readdirSync(path.join(TEST, "images")).sort();
const picked: string[] = [];
for (const [src, n] of Object.entries(PER_SOURCE)) {
  const files = all.filter((f) => f.startsWith(src + "_"));
  const step = files.length / n;
  for (let i = 0; i < n; i++) picked.push(files[Math.floor(i * step)]);
}

type Row = { id: string; image: string; source: string; index: number; type: string; box: number[]; crop: string; prefill: string };
const rows: Row[] = [];
for (const [k, f] of picked.entries()) {
  const img = await decode(path.join(TEST, "images", f));
  const labels = fs.readFileSync(path.join(TEST, "labels", f.replace(/\.jpg$/, ".txt")), "utf8").split("\n").filter((l) => l.trim());
  for (const [i, l] of labels.entries()) {
    const [cls, ...v] = l.trim().split(/\s+/).map(Number);
    const xs = v.filter((_, j) => j % 2 === 0), ys = v.filter((_, j) => j % 2 === 1);
    const nb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const box: PlateBox = { x1: nb[0] * img.width, y1: nb[1] * img.height, x2: nb[2] * img.width, y2: nb[3] * img.height, conf: 1, type: cls === 0 ? "1line" : "2line" };
    const r = await readBest(ocr, img, box, DEFAULT_VARIANTS);
    const c = await crop(img, box, 0.15);
    const name = `${f.split(".")[0].slice(0, 40)}_${i}.png`;
    await sharp(c.data, { raw: { width: c.width, height: c.height, channels: 3 } }).resize({ height: 90, withoutEnlargement: false }).png().toFile(path.join(OUT, "crops", name));
    rows.push({ id: `${f}#${i}`, image: f, source: f.split("_")[0], index: i, type: box.type, box: nb.map((x) => +x.toFixed(5)), crop: `crops/${name}`, prefill: r.valid ? r.norm : "" });
  }
  if ((k + 1) % 50 === 0) console.log(`${k + 1}/${picked.length} images`);
}

fs.writeFileSync(path.join(OUT, "prefill.csv"), ["id,image,source,index,type,x1,y1,x2,y2,prefill", ...rows.map((r) => [r.id, r.image, r.source, r.index, r.type, ...r.box, r.prefill].join(","))].join("\n") + "\n");

// self-contained review page (open the file directly in a browser)
const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Duyệt đáp án 200 ảnh</title>
<style>
:root{--bg:#f4f6fa;--card:#fff;--fg:#0f172a;--muted:#5b6577;--border:#dfe4ec;--ok:#15803d;--warn:#b45309;--pri:#1d4ed8}
@media (prefers-color-scheme:dark){:root{--bg:#0b1020;--card:#121a2e;--fg:#e5e9f2;--muted:#93a0b8;--border:#253150;--ok:#4ade80;--warn:#fbbf24;--pri:#3b82f6}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI",system-ui,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--card);border-bottom:1px solid var(--border);padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}
h1{font-size:16px;margin:0 12px 0 0}.muted{color:var(--muted)}
button{background:var(--pri);color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;padding:16px}
.c{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px}
.c.done{border-color:var(--ok)}.c img{display:block;height:90px;max-width:100%;margin:0 auto 8px;border-radius:4px;image-rendering:auto}
.row{display:flex;gap:6px;align-items:center}input[type=text]{flex:1;min-width:0;font:600 16px Consolas,monospace;padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);text-transform:uppercase}
.meta{font-size:11px;color:var(--muted);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
label.ck{display:flex;gap:4px;align-items:center;font-size:12px;white-space:nowrap}
</style></head><body>
<header><h1>Duyệt đáp án tập kiểm thử</h1>
<span class="muted">Sửa ô nào đọc sai (chỉ chữ và số, ví dụ 51F15585). Biển không đọc được bằng mắt: tích "Bỏ". Đánh dấu ✓ khi đã kiểm tra.</span>
<span id="stat" class="muted"></span><button id="dl">Tải answers.csv</button></header>
<main id="m"></main>
<script>
const rows=${JSON.stringify(rows.map(({ id, source, type, crop, prefill }) => ({ id, source, type, crop, prefill })))};
const KEY="anpr-eval-200";let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
const m=document.getElementById("m");
for(const r of rows){const s=saved[r.id]||{v:r.prefill,ok:false,skip:false};
const d=document.createElement("div");d.className="c"+(s.ok?" done":"");
d.innerHTML='<img loading="lazy" src="'+r.crop+'" alt=""><div class="row"><input type="text" value="'+s.v+'" aria-label="đáp án"><label class="ck"><input type="checkbox" class="ok"'+(s.ok?" checked":"")+'>✓</label><label class="ck"><input type="checkbox" class="skip"'+(s.skip?" checked":"")+'>Bỏ</label></div><div class="meta">'+r.source+' · '+(r.type==="2line"?"2 dòng":"1 dòng")+' · '+r.id+'</div>';
const save=()=>{saved[r.id]={v:d.querySelector("input[type=text]").value.toUpperCase().replace(/[^0-9A-Z]/g,""),ok:d.querySelector(".ok").checked,skip:d.querySelector(".skip").checked};d.className="c"+(saved[r.id].ok?" done":"");try{localStorage.setItem(KEY,JSON.stringify(saved))}catch{}stat()};
d.querySelectorAll("input").forEach(i=>i.addEventListener("change",save));m.appendChild(d);}
function stat(){const n=rows.filter(r=>saved[r.id]?.ok).length;document.getElementById("stat").textContent="Đã kiểm tra "+n+"/"+rows.length}
stat();
document.getElementById("dl").onclick=()=>{const lines=["id,answer,skip,checked"];for(const r of rows){const s=saved[r.id]||{v:r.prefill,ok:false,skip:false};lines.push([r.id,s.v,s.skip?1:0,s.ok?1:0].join(","))}
const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines.join("\\n")+"\\n"],{type:"text/csv"}));a.download="answers.csv";a.click()};
</script></body></html>`;
fs.writeFileSync(path.join(OUT, "review.html"), html);
console.log(`${picked.length} images, ${rows.length} plates (${rows.filter((r) => r.prefill).length} pre-filled) -> ${path.join(OUT, "review.html")}`);
