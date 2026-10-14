import express, { Router } from "express";
import { z } from "zod";
import { HttpError } from "../middlewares/error.ts";
import { decode } from "../recognition/image.ts";
import { closeSession, getSession, openSession } from "../services/camera.ts";
import { getRecognizer } from "../services/recognize.ts";
import { saveVehicle } from "../services/vehicles.ts";

export const cameraRouter = Router();

// POST /api/camera -> { id }: start a live session
cameraRouter.post("/", (req, res) => {
  const userId = req.user!.id;
  const s = openSession(userId, getRecognizer(), (frame, plate, ms) => saveVehicle(frame, plate, userId, "webcam", ms));
  res.status(201).json({ id: s.id });
});

// POST /api/camera/:id/frames  body: one JPEG frame, header X-Frame-Time: capture time in seconds (client clock)
cameraRouter.post("/:id/frames", express.raw({ type: "image/jpeg", limit: "4mb" }), async (req, res) => {
  const s = getSession(String(req.params.id), req.user!);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, "Thiếu khung hình JPEG");
  const t = z.coerce.number().finite().parse(req.get("X-Frame-Time"));
  let img;
  try {
    img = await decode(req.body);
  } catch {
    throw new HttpError(400, "Khung hình không phải ảnh JPEG hợp lệ");
  }
  res.json(await s.frame(img, t));
});

// DELETE /api/camera/:id -> { saved }: stop, saving the vehicles still in view
cameraRouter.delete("/:id", async (req, res) => {
  res.json({ saved: await closeSession(getSession(String(req.params.id), req.user!)) });
});
