import { Router } from "express";
import { uploadImage } from "../middlewares/upload.ts";
import { HttpError } from "../middlewares/error.ts";
import { recognizeAndSave } from "../services/recognize.ts";

export const recognizeRouter = Router();

// POST /api/recognize (multipart field "image")
recognizeRouter.post("/", uploadImage, async (req, res) => {
  if (!req.file) throw new HttpError(400, "Thiếu ảnh (trường 'image')");
  res.json(await recognizeAndSave(req.file.buffer, req.file.mimetype, req.user!.id, "upload"));
});
