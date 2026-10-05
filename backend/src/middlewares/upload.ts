// Image upload (docs 8.3): JPG/PNG only, max 5 MB, kept in memory then saved under a UUID name
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
