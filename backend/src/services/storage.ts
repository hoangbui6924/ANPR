// Files on local disk under uploads/ (docs 8.1: originals/, crops/). The DB only stores relative paths (docs 8.3).
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { config } from "../config.ts";

export const UPLOAD_URL = "/uploads";

export async function ensureDirs() {
  await fs.mkdir(path.join(config.uploadDir, "originals"), { recursive: true });
  await fs.mkdir(path.join(config.uploadDir, "crops"), { recursive: true });
}

export const urlFor = (rel: string | null | undefined) => (rel ? `${UPLOAD_URL}/${rel.replace(/\\/g, "/")}` : null);

/** Save the uploaded image (EXIF orientation applied, so boxes match what the browser shows) */
export async function saveOriginal(buf: Buffer, mimetype: string) {
  const id = randomUUID();
  const ext = mimetype === "image/png" ? "png" : "jpg";
  const rel = `originals/${id}.${ext}`;
  const img = sharp(buf).rotate();
  await (ext === "png" ? img.png() : img.jpeg({ quality: 92 })).toFile(path.join(config.uploadDir, rel));
  return { id, rel };
}

/** Save a plate crop next to its original: crops/<uuid>_<i>.jpg (box widened 6% like the OCR crop) */
export async function saveCrop(buf: Buffer, id: string, i: number, bbox: [number, number, number, number], width: number, height: number) {
  const [x1, y1, x2, y2] = bbox;
  const pw = (x2 - x1) * 0.06, ph = (y2 - y1) * 0.06;
  const left = Math.max(0, Math.floor(x1 - pw)), top = Math.max(0, Math.floor(y1 - ph));
  const w = Math.min(width - left, Math.ceil(x2 - x1 + 2 * pw)), h = Math.min(height - top, Math.ceil(y2 - y1 + 2 * ph));
  if (w < 2 || h < 2) return null;
  const rel = `crops/${id}_${i}.jpg`;
  await sharp(buf).rotate().extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toFile(path.join(config.uploadDir, rel));
  return rel;
}

export async function removeFiles(rels: (string | null | undefined)[]) {
  await Promise.all(rels.filter(Boolean).map((r) => fs.rm(path.join(config.uploadDir, r!), { force: true })));
}
