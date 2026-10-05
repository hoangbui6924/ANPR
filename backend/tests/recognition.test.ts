// Recognition module: pure helpers + an end-to-end check on two dataset images (skipped when models are missing)
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { groupBoxes, type PlateBox } from "../src/recognition/detect.ts";
import { plateRows } from "../src/recognition/ocr.ts";
import { createRecognizer } from "../src/recognition/index.ts";

const box = (x1: number, y1: number, x2: number, y2: number, conf: number): PlateBox => ({ x1, y1, x2, y2, conf, type: "1line" });

describe("groupBoxes", () => {
  it("groups overlapping sightings and keeps the most confident one first", () => {
    const g = groupBoxes([box(10, 10, 50, 30, 0.5), box(12, 11, 51, 31, 0.9), box(200, 200, 240, 220, 0.7)]);
    expect(g).toHaveLength(2);
    expect(g[0].box.conf).toBe(0.9);
    expect(g[0].members).toHaveLength(2);
  });
  it("treats a box mostly inside another (cut by a tile edge) as the same plate", () => {
    expect(groupBoxes([box(0, 0, 100, 40, 0.8), box(0, 0, 45, 40, 0.6)])).toHaveLength(1);
  });
});

describe("plateRows", () => {
  it("splits a 2-line plate at the bright gap between the rows", async () => {
    // white plate 120x100 with two dark text bands: rows 15-40 and 60-85
    const w = 120, h = 100, data = Buffer.alloc(w * h * 3, 255);
    for (let y = 0; y < h; y++) {
      if ((y >= 15 && y < 40) || (y >= 60 && y < 85)) for (let x = 15; x < 105; x += 2) data.fill(0, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
    const rows = await plateRows({ data, width: w, height: h }, "2line");
    expect(rows).toHaveLength(2);
    expect(rows[0].height).toBeGreaterThan(40);
    expect(rows[0].height).toBeLessThan(60);
    expect(rows[1].height).toBeGreaterThan(40);
  });
  it("returns the crop unchanged for a 1-line plate", async () => {
    const c = { data: Buffer.alloc(30 * 10 * 3), width: 30, height: 10 };
    expect(await plateRows(c, "1line")).toEqual([c]);
  });
});

const MODELS = path.resolve(import.meta.dirname, "../models");
const haveModels = ["plate.onnx", "rec_ch_v4_server.onnx"].every((f) => fs.existsSync(path.join(MODELS, f)));

describe.skipIf(!haveModels)("recognize (real models)", () => {
  it("reads a 1-line car plate and a 2-line motorbike plate", async () => {
    const recognize = await createRecognizer({ modelsDir: MODELS });
    const car = await recognize(path.join(import.meta.dirname, "fixtures/car-1line.jpg"));
    expect(car.plates.map((p) => p.text)).toContain("56N-7186");
    const moto = await recognize(path.join(import.meta.dirname, "fixtures/moto-2line.jpg"));
    expect(moto.plates[0]).toMatchObject({ text: "59-S2 447.17", type: "2line", vehicle: "motorbike", valid: true });
  }, 60_000);

  it("accepts a buffer and returns boxes inside the image", async () => {
    const recognize = await createRecognizer({ modelsDir: MODELS });
    const buf = await sharp(path.join(import.meta.dirname, "fixtures/car-1line.jpg")).png().toBuffer();
    const r = await recognize(buf);
    for (const p of r.plates) {
      expect(p.bbox[0]).toBeGreaterThanOrEqual(0);
      expect(p.bbox[2]).toBeLessThanOrEqual(r.width);
    }
  }, 60_000);
});
