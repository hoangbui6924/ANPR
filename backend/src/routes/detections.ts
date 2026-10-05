import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";
import { Prisma } from "../generated/prisma/client.ts";
import { requireRole } from "../middlewares/auth.ts";
import { HttpError } from "../middlewares/error.ts";
import { detectionDtos, detectionInclude } from "../services/dto.ts";
import { removeFiles } from "../services/storage.ts";
import { normalizeQuery } from "./plates.ts";

export const detectionsRouter = Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// GET /api/detections?page&pageSize&q&from&to  (q: plate, substring or pg_trgm similarity)
detectionsRouter.get("/", async (req, res) => {
  const { page, pageSize, q, from, to } = listQuery.parse(req.query);
  const where: Prisma.DetectionWhereInput = {};
  if (from || to) {
    where.createdAt = {
      ...(from && { gte: new Date(`${from}T00:00:00`) }),
      ...(to && { lt: new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000) }),
    };
  }
  const nq = q ? normalizeQuery(q) : "";
  if (nq) {
    const ids = await prisma.$queryRaw<{ detection_id: number }[]>`
      SELECT DISTINCT detection_id FROM plates
      WHERE plate_norm LIKE ${"%" + nq + "%"} OR plate_norm % ${nq}`;
    where.id = { in: ids.map((r) => r.detection_id) };
  }
  const [total, rows] = await Promise.all([
    prisma.detection.count({ where }),
    prisma.detection.findMany({ where, include: detectionInclude, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ items: await detectionDtos(rows), total, page, pageSize });
});

detectionsRouter.get("/:id", async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const row = await prisma.detection.findUnique({ where: { id }, include: detectionInclude });
  if (!row) throw new HttpError(404, "Không tìm thấy lần nhận dạng");
  res.json((await detectionDtos([row]))[0]);
});

// admin only (docs 8.2)
detectionsRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const row = await prisma.detection.findUnique({ where: { id }, include: { plates: true } });
  if (!row) throw new HttpError(404, "Không tìm thấy lần nhận dạng");
  await prisma.detection.delete({ where: { id } });
  await removeFiles([row.imagePath, ...row.plates.map((p) => p.cropPath)]);
  res.status(204).end();
});
