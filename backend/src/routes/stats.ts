import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";

export const statsRouter = Router();

statsRouter.get("/summary", async (_req, res) => {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [totalDetections, today, totalPlates, valid, motorbike, car, black] = await Promise.all([
    prisma.detection.count(),
    prisma.detection.count({ where: { createdAt: { gte: startOfDay } } }),
    prisma.plate.count(),
    prisma.plate.count({ where: { isValid: true } }),
    prisma.plate.count({ where: { vehicleType: "motorbike" } }),
    prisma.plate.count({ where: { vehicleType: "car" } }),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM plates p JOIN vehicle_lists v ON v.plate_norm = p.plate_norm WHERE v.kind = 'black'`,
  ]);
  res.json({
    totalDetections,
    totalPlates,
    today,
    validRate: totalPlates ? valid / totalPlates : 0,
    motorbike,
    car,
    blacklistHits: Number(black[0]?.n ?? 0),
  });
});

// GET /api/stats/daily?days=14  (days without detections are returned as 0)
statsRouter.get("/daily", async (req, res) => {
  const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(14) }).parse(req.query);
  const rows = await prisma.$queryRaw<{ day: string; detections: bigint; plates: bigint }[]>`
    SELECT to_char(g.day, 'YYYY-MM-DD') AS day,
           COUNT(DISTINCT d.id) AS detections,
           COUNT(p.id) AS plates
    FROM generate_series(current_date - (${days}::int - 1), current_date, interval '1 day') AS g(day)
    LEFT JOIN detections d ON d.created_at >= g.day AND d.created_at < g.day + interval '1 day'
    LEFT JOIN plates p ON p.detection_id = d.id
    GROUP BY g.day ORDER BY g.day`;
  res.json(rows.map((r) => ({ date: r.day, detections: Number(r.detections), plates: Number(r.plates) })));
});
