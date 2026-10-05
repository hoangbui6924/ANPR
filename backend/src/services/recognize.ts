// Recognize an uploaded image, store files + rows, return the POST /api/recognize payload (docs 2.6 flow)
import { prisma } from "../db.ts";
import { config } from "../config.ts";
import { createRecognizer, type Recognizer } from "../recognition/index.ts";
import { listMatches, plateDto } from "./dto.ts";
import { saveCrop, saveOriginal, urlFor } from "./storage.ts";

let recognizer: Recognizer | null = null;

/** Load the ONNX models once at startup (docs 6.5) */
export async function initRecognizer() {
  recognizer = await createRecognizer({ modelsDir: config.modelsDir });
}

export async function recognizeAndSave(buf: Buffer, mimetype: string, userId: number | null, source: "upload" | "webcam" = "upload") {
  if (!recognizer) throw new Error("Recognizer not initialised");
  const r = await recognizer(buf);
  const { id, rel } = await saveOriginal(buf, mimetype);
  const crops = await Promise.all(r.plates.map((p, i) => saveCrop(buf, id, i, p.bbox, r.width, r.height)));

  const det = await prisma.detection.create({
    data: {
      imagePath: rel,
      source,
      createdBy: userId,
      processMs: r.ms,
      plates: {
        create: r.plates.map((p, i) => ({
          plateText: p.text,
          plateNorm: p.norm,
          plateType: p.type,
          vehicleType: p.vehicle,
          detConf: p.detConf,
          ocrConf: p.ocrConf,
          bbox: p.bbox,
          cropPath: crops[i],
          isValid: p.valid,
        })),
      },
    },
    include: { plates: { orderBy: { id: "asc" } } },
  });

  const lists = await listMatches(det.plates.map((p) => p.plateNorm));
  return {
    detectionId: det.id,
    imageUrl: urlFor(det.imagePath)!,
    processMs: r.ms,
    plates: det.plates.map((p) => plateDto(p, lists)),
  };
}
