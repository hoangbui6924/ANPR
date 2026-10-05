import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";
import { clean } from "../recognition/postprocess.ts";

export const platesRouter = Router();

export const normalizeQuery = (q: string) => clean(q).slice(0, 12);

// GET /api/plates/search?q=  fuzzy plate search with pg_trgm (docs 7.2)
platesRouter.get("/search", async (req, res) => {
  const { q } = z.object({ q: z.string().min(1) }).parse(req.query);
  const nq = normalizeQuery(q);
  if (!nq) return res.json([]);
  const rows = await prisma.$queryRaw<{ plate_text: string; plate_norm: string; score: number; detection_id: number; created_at: Date }[]>`
    SELECT p.plate_text, p.plate_norm, similarity(p.plate_norm, ${nq})::float AS score, p.detection_id, d.created_at
    FROM plates p JOIN detections d ON d.id = p.detection_id
    WHERE p.plate_norm % ${nq} OR p.plate_norm LIKE ${"%" + nq + "%"}
    ORDER BY score DESC, d.created_at DESC
    LIMIT 20`;
  res.json(
    rows.map((r) => ({ plateText: r.plate_text, plateNorm: r.plate_norm, score: Number(r.score.toFixed(3)), detectionId: r.detection_id, createdAt: r.created_at.toISOString() })),
  );
});
