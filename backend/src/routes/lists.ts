import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.ts";
import { HttpError } from "../middlewares/error.ts";
import { clean, formatPlate } from "../recognition/postprocess.ts";

export const listsRouter = Router();

const kind = z.enum(["white", "black"]);
const dto = (e: { id: number; plateNorm: string; plateText: string; kind: string; note: string | null; createdAt: Date }) => ({
  id: e.id,
  plateNorm: e.plateNorm,
  plateText: e.plateText,
  kind: e.kind,
  note: e.note,
  createdAt: e.createdAt.toISOString(),
});

listsRouter.get("/", async (req, res) => {
  const { kind: k } = z.object({ kind: kind.optional() }).parse(req.query);
  const rows = await prisma.vehicleList.findMany({ where: k ? { kind: k } : {}, orderBy: { createdAt: "desc" } });
  res.json(rows.map(dto));
});

listsRouter.post("/", async (req, res) => {
  const body = z.object({ plateText: z.string().min(1), kind, note: z.string().max(200).optional() }).parse(req.body);
  const norm = clean(body.plateText);
  if (norm.length < 6 || norm.length > 10) throw new HttpError(400, "Biển số không hợp lệ");
  if (await prisma.vehicleList.findUnique({ where: { plateNorm: norm } })) throw new HttpError(409, "Biển số này đã có trong danh sách");
  const row = await prisma.vehicleList.create({
    data: { plateNorm: norm, plateText: formatPlate(norm).text, kind: body.kind, note: body.note || null, createdBy: req.user!.id },
  });
  res.status(201).json(dto(row));
});

listsRouter.put("/:id", async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = z.object({ kind: kind.optional(), note: z.string().max(200).nullable().optional() }).parse(req.body);
  const row = await prisma.vehicleList.update({ where: { id }, data: body }).catch(() => null);
  if (!row) throw new HttpError(404, "Không tìm thấy");
  res.json(dto(row));
});

listsRouter.delete("/:id", async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  await prisma.vehicleList.delete({ where: { id } }).catch(() => null);
  res.status(204).end();
});
