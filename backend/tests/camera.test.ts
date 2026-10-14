// Live camera session with a fake detector / OCR: one save per vehicle, confirmation by agreeing reads, dedup
import { describe, expect, it } from "vitest";
import type { PlateBox } from "../src/recognition/detect.ts";
import type { Decoded } from "../src/recognition/image.ts";
import type { RecognizedPlate } from "../src/recognition/index.ts";
import { CameraSession, type CameraEngine, type SavedVehicle } from "../src/services/camera.ts";

const img: Decoded = { data: Buffer.alloc(0), width: 1000, height: 500 };
const box = (x: number): PlateBox => ({ x1: x, y1: 200, x2: x + 80, y2: 230, conf: 0.9, type: "1line" });
const plate = (norm: string, valid = true): RecognizedPlate => ({
  text: norm, norm, type: "1line", vehicle: "car", detConf: 0.9, ocrConf: 0.9, valid, bbox: [0, 0, 1, 1],
});
const settle = () => new Promise((r) => setTimeout(r, 0)); // let the background reads run

function setup(read: () => RecognizedPlate | null) {
  let frameBoxes: PlateBox[] = [];
  const engine: CameraEngine = { detect: async () => frameBoxes, readPlate: async () => read() };
  const saved: string[] = [];
  const s = new CameraSession(1, engine, async (_f, p) => {
    saved.push(p.norm);
    return { detectionId: saved.length, imageUrl: "", plate: { ...p, cropUrl: null, list: null } } as unknown as SavedVehicle;
  });
  const frame = async (t: number, boxes: PlateBox[]) => {
    frameBoxes = boxes;
    const r = await s.frame(img, t);
    await settle();
    return r;
  };
  return { s, frame, saved };
}

describe("CameraSession", () => {
  it("saves a vehicle once, after two agreeing reads, and labels its box", async () => {
    const { frame, saved } = setup(() => plate("51F15585"));
    let last;
    for (let i = 0; i < 12; i++) last = await frame(i / 8, [box(100 + i * 10)]);
    expect(saved).toEqual(["51F15585"]);
    expect(last!.boxes[0]).toMatchObject({ text: "51F15585", confirmed: true });
    expect(last!.boxes[0].box[0]).toBeCloseTo(0.21);
  });

  it("does not save the same plate again when it comes back within 10 s", async () => {
    const { frame, saved } = setup(() => plate("51F15585"));
    for (let i = 0; i < 6; i++) await frame(i / 8, [box(100)]);
    for (let i = 0; i < 12; i++) await frame(1 + i / 8, []); // gone: track closes
    for (let i = 0; i < 6; i++) await frame(3 + i / 8, [box(600)]); // back, new track
    expect(saved).toEqual(["51F15585"]);
  });

  it("never saves something that does not read as a valid plate (lane marking)", async () => {
    const { s, frame, saved } = setup(() => plate("171156", false));
    for (let i = 0; i < 20; i++) await frame(i / 8, [box(300)]);
    await s.close();
    expect(saved).toEqual([]);
  });

  it("saves a vehicle that left quickly with a single valid read when the session closes", async () => {
    const { s, frame, saved } = setup(() => plate("30E22070"));
    for (let i = 0; i < 3; i++) await frame(i / 8, [box(100 + i * 5)]);
    expect(await s.close()).toHaveLength(saved.length);
    expect(saved).toEqual(["30E22070"]);
  });
});

describe("CameraSession: unreadable plates", () => {
  it("does not save a plate whose reads never agree", async () => {
    const reads = ["59G700774", "54B200174", "79B20774", "51G70774"];
    let i = 0;
    const { s, frame, saved } = setup(() => plate(reads[i++ % reads.length]));
    for (let k = 0; k < 20; k++) await frame(k / 8, [box(300)]);
    await s.close();
    expect(saved).toEqual([]);
  });
});

