// Files on local disk under uploads/ (docs 8.1: originals/, crops/). The DB only stores relative paths (docs 8.3).
import fs from "node:fs/promises";
import path from "node:path";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import sharp from "sharp";
import { config } from "../config.ts";

export const UPLOAD_URL = "/uploads";

export async function ensureDirs() {
  await fs.mkdir(path.join(config.uploadDir, "originals"), { recursive: true });
  await fs.mkdir(path.join(config.uploadDir, "crops"), { recursive: true });
}

// ---------- signed image URLs ----------
// <img> tags cannot send the JWT, so image URLs carry an expiry + HMAC signature instead.
// The expiry is rounded to the hour so the same image keeps the same URL (browser cache) for a while.
const URL_TTL_S = 24 * 3600;

function sign(rel: string, exp: number) {
  return createHmac("sha256", config.jwtSecret).update(`${rel}:${exp}`).digest("base64url").slice(0, 32);
}

export function urlFor(rel: string | null | undefined) {
  if (!rel) return null;
  const path_ = rel.replace(/\\/g, "/");
  const exp = Math.ceil((Date.now() / 1000 + URL_TTL_S) / 3600) * 3600;
  return `${UPLOAD_URL}/${path_}?exp=${exp}&sig=${sign(path_, exp)}`;
}

/** Express middleware in front of the static /uploads handler */
export function verifySignedUrl(req: Request, res: Response, next: NextFunction) {
  const rel = decodeURIComponent(req.path.replace(/^\//, ""));
  const exp = Number(req.query.exp), sig = String(req.query.sig ?? "");
  const expected = Buffer.from(sign(rel, exp));
  const ok = exp * 1000 > Date.now() && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), expected);
  if (!ok) return res.status(403).json({ message: "Liên kết ảnh không hợp lệ hoặc đã hết hạn" });
  next();
}

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
