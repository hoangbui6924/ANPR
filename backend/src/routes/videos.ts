import { Router } from "express";
import { z } from "zod";
import { uploadVideo } from "../middlewares/upload.ts";
import { HttpError } from "../middlewares/error.ts";
import { getJob, jobDto, startVideoJob } from "../services/video.ts";

export const videosRouter = Router();

// POST /api/videos (multipart field "video") -> 202 + job; the video is processed in the background
videosRouter.post("/", uploadVideo, async (req, res) => {
  if (!req.file) throw new HttpError(400, "Thiếu video (trường 'video')");
  const job = await startVideoJob(req.file.path, req.user!.id);
  res.status(202).json(jobDto(job));
});

// GET /api/videos/:id?since=n  (progress + the vehicles found from index n on)
videosRouter.get("/:id", (req, res) => {
  const since = z.coerce.number().int().min(0).default(0).parse(req.query.since);
  res.json(jobDto(getJob(String(req.params.id), req.user!), since));
});
