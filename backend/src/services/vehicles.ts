// Shared by video files and the live camera: one vehicle = one detection (its clearest frame + plate crop),
// so history and stats work unchanged.
import sharp from "sharp";
import { prisma } from "../db.ts";
import type { Decoded } from "../recognition/image.ts";
import type { RecognizedPlate } from "../recognition/index.ts";
import { listMatches, plateDto } from "./dto.ts";
import { saveCrop, saveOriginal, urlFor } from "./storage.ts";

/** Save one vehicle: its frame as the detection image, the plate crop, one plate row */
export async function saveVehicle(frame: Decoded, p: RecognizedPlate, userId: number, source: "video" | "webcam", processMs: number) {
  const jpg = await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const { id, rel } = await saveOriginal(jpg, "image/jpeg");
  const crop = await saveCrop(jpg, id, 0, p.bbox, frame.width, frame.height);
  const det = await prisma.detection.create({
    data: {
      imagePath: rel,
      source,
      createdBy: userId,
      processMs: Math.round(processMs),
      plates: {
        create: [{ plateText: p.text, plateNorm: p.norm, plateType: p.type, vehicleType: p.vehicle, detConf: p.detConf, ocrConf: p.ocrConf, bbox: p.bbox, cropPath: crop, isValid: p.valid }],
      },
    },
    include: { plates: true },
  });
  const lists = await listMatches([p.norm]);
  return { detectionId: det.id, imageUrl: urlFor(det.imagePath)!, plate: plateDto(det.plates[0], lists) };
}
