// Uploads (docs 8.3). Images: JPG/PNG only, max 5 MB, kept in memory then saved under a UUID name.
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { config } from "../config.ts";
import { HttpError } from "./error.ts";

export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "image/jpeg" || file.mimetype === "image/png") cb(null, true);
    else cb(new HttpError(400, "Chỉ nhận ảnh JPG hoặc PNG"));
  },
}).single("image");

// Video upload: up to 200 MB, written to uploads/tmp (too big for memory), deleted after processing
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo", "video/avi"]);

export const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: path.join(config.uploadDir, "tmp"),
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.video`),
  }),
  limits: { fileSize: config.video.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (VIDEO_TYPES.has(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, "Chỉ nhận video MP4, WebM, MOV, MKV hoặc AVI"));
  },
}).single("video");
