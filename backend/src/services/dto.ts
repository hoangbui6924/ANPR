// DB rows -> JSON shapes the frontend expects (docs 8.2; mirrored in frontend/src/api/types.ts)
import type { Detection, Plate, User } from "../generated/prisma/client.ts";
import { prisma } from "../db.ts";
import { urlFor } from "./storage.ts";

export type ListMatch = { kind: "white" | "black"; note: string | null } | null;

export function userDto(u: User) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, active: u.active, createdAt: u.createdAt.toISOString() };
}

/** White/black list entries for a set of normalized plates */
export async function listMatches(norms: string[]): Promise<Map<string, ListMatch>> {
  if (!norms.length) return new Map();
  const rows = await prisma.vehicleList.findMany({ where: { plateNorm: { in: [...new Set(norms)] } } });
  return new Map(rows.map((r) => [r.plateNorm, { kind: r.kind as "white" | "black", note: r.note }]));
}

export function plateDto(p: Plate, lists: Map<string, ListMatch>) {
  return {
    text: p.plateText,
    norm: p.plateNorm,
    type: p.plateType,
    vehicle: p.vehicleType,
    detConf: p.detConf,
    ocrConf: p.ocrConf,
    valid: p.isValid,
    bbox: p.bbox as [number, number, number, number],
    cropUrl: urlFor(p.cropPath),
    list: lists.get(p.plateNorm) ?? null,
  };
}

type DetectionWith = Detection & { plates: Plate[]; creator: { username: string } | null };

export async function detectionDtos(rows: DetectionWith[]) {
  const lists = await listMatches(rows.flatMap((d) => d.plates.map((p) => p.plateNorm)));
  return rows.map((d) => ({
    id: d.id,
    imageUrl: urlFor(d.imagePath)!,
    source: d.source,
    createdBy: d.creator?.username ?? null,
    processMs: d.processMs,
    createdAt: d.createdAt.toISOString(),
    plates: d.plates.map((p) => plateDto(p, lists)),
  }));
}

export const detectionInclude = { plates: { orderBy: { id: "asc" as const } }, creator: { select: { username: true } } };
