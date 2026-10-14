// Live camera (congvieccanlam.md, giai đoạn 3). The browser shows the webcam itself and posts one frame at a time
// (the next only after this answer, so delay never piles up). Each frame only goes through the plate detector and
// the tracker (~120 ms); OCR runs in the background on each vehicle's best frames, one read at a time per session.
// A vehicle is saved once (source "webcam") as soon as two reads agree, or when it leaves with one valid read.
import { randomUUID } from "node:crypto";
import type { PlateBox } from "../recognition/detect.ts";
import type { Decoded } from "../recognition/image.ts";
import type { RecognizedPlate } from "../recognition/index.ts";
import { Tracker, type Track } from "../recognition/track.ts";
import { HttpError } from "../middlewares/error.ts";
import { Candidates, votePlate, type Candidate } from "../recognition/candidates.ts";
import type { saveVehicle } from "./vehicles.ts";

const CANDIDATES = 3; // best frames kept per vehicle
const MAX_READS = 4; // OCR reads per vehicle before giving up on agreement
const CONFIRM_VOTES = 2; // agreeing valid reads that confirm (and save) a plate
const DEDUP_S = 10; // the same plate saved again within this time is the same vehicle (stopped at a gate, lost and found)
const IDLE_MS = 30_000; // sessions without frames are closed

/** What the session needs from the recognizer (a fake in tests) */
export interface CameraEngine {
  detect(img: Decoded): Promise<PlateBox[]>;
  readPlate(img: Decoded, sightings: PlateBox[], opts?: { quick?: boolean }): Promise<RecognizedPlate | null>;
}
export type SaveFn = (frame: Decoded, plate: RecognizedPlate, ms: number) => Promise<SavedVehicle>;
export type SavedVehicle = Awaited<ReturnType<typeof saveVehicle>>;

interface Vehicle {
  reads: { plate: RecognizedPlate; frame: Decoded }[];
  tries: number; // reads attempted, including the ones that gave nothing
  readCands: Set<Candidate>; // candidates already read (each is one frame + box)
  shown: RecognizedPlate | null; // current best reading, drawn before it is confirmed
  saved: SavedVehicle | null;
  ocrMs: number;
}

export interface LiveBox {
  id: number; // track id: stable while the vehicle stays in view
  box: [number, number, number, number]; // x1, y1, x2, y2 in 0..1 of the frame
  text: string | null;
  type: RecognizedPlate["type"];
  confirmed: boolean;
  black: boolean;
}

export class CameraSession {
  readonly id = randomUUID();
  readonly userId: number;
  lastActive = Date.now();
  private engine: CameraEngine;
  private save: SaveFn;
  private tracker = new Tracker(1);
  private cands = new Candidates(CANDIDATES);
  private vehicles = new Map<number, Vehicle>();
  private recent: { norm: string; t: number; saved: SavedVehicle }[] = [];
  private newlySaved: SavedVehicle[] = [];
  private ocr: Promise<void> | null = null; // the one background read in flight
  private lastT = 0;

  constructor(userId: number, engine: CameraEngine, save: SaveFn) {
    this.userId = userId;
    this.engine = engine;
    this.save = save;
  }

  /** One frame at time t (seconds, client clock): detect, track, maybe start a read; returns what to draw */
  async frame(img: Decoded, t: number) {
    this.lastActive = Date.now();
    this.lastT = t;
    const t0 = performance.now();
    const boxes = await this.engine.detect(img);
    for (const tr of this.tracker.update(t, boxes)) this.closeTrack(tr);

    const live: LiveBox[] = [];
    let next: { tr: Track; v: Vehicle } | null = null; // the vehicle to read now: the one read least so far
    for (const b of boxes) {
      const tr = this.tracker.trackOf(b)!;
      this.cands.add(tr.id, img, b);
      const v = this.vehicle(tr.id);
      if (rejected(v)) continue; // read twice, never a valid plate: a lane marking or a sticker, not drawn
      if (!v.saved && v.tries < MAX_READS && tr.sightings.length >= 2 && (!next || v.tries < next.v.tries)) next = { tr, v };
      const p = v.saved?.plate ?? v.shown;
      live.push({
        id: tr.id,
        box: [b.x1 / img.width, b.y1 / img.height, b.x2 / img.width, b.y2 / img.height].map((x) => +x.toFixed(4)) as LiveBox["box"],
        text: p?.text ?? null,
        type: (p?.type ?? b.type) as LiveBox["type"],
        confirmed: !!v.saved,
        black: v.saved?.plate.list?.kind === "black",
      });
    }
    if (next && !this.ocr) this.startRead(next.tr);
    const saved = this.newlySaved;
    this.newlySaved = [];
    return { t, ms: Math.round(performance.now() - t0), boxes: live, saved };
  }

  /** End of session: wait for the read in flight, then save what was read of the vehicles still in view */
  async close() {
    await this.ocr;
    for (const tr of this.tracker.flush()) this.closeTrack(tr);
    await this.ocr;
    const saved = this.newlySaved;
    this.newlySaved = [];
    return saved;
  }

  private vehicle(id: number) {
    let v = this.vehicles.get(id);
    if (!v) this.vehicles.set(id, (v = { reads: [], tries: 0, readCands: new Set(), shown: null, saved: null, ocrMs: 0 }));
    return v;
  }

  /** Read the vehicle's best frame not read yet, in the background */
  private startRead(tr: Track) {
    const v = this.vehicle(tr.id);
    const c = this.cands.get(tr.id).find((x) => !v.readCands.has(x));
    if (!c) return;
    v.readCands.add(c);
    v.tries++;
    this.ocr = this.chain(async () => {
      const t0 = performance.now();
      const p = await this.engine.readPlate(c.frame, [c.box], { quick: true });
      v.ocrMs += performance.now() - t0;
      if (p) v.reads.push({ plate: p, frame: c.frame });
      const pick = votePlate(v.reads);
      v.shown = pick?.plate ?? v.shown;
      if (pick && pick.votes >= CONFIRM_VOTES && !v.saved) await this.saveOnce(v, pick);
    });
  }

  /** A vehicle left the view: save it with the reads it got, then forget it */
  private closeTrack(tr: Track) {
    const v = this.vehicles.get(tr.id);
    this.vehicles.delete(tr.id);
    const cands = this.cands.get(tr.id);
    this.cands.delete(tr.id);
    if (!v || v.saved || rejected(v) || tr.sightings.length < 3) return;
    this.ocr = this.chain(async () => {
      // never read (left quickly): one quick read of its best frame
      if (!v.tries && cands[0]) {
        const p = await this.engine.readPlate(cands[0].frame, [cands[0].box], { quick: true });
        if (p) v.reads.push({ plate: p, frame: cands[0].frame });
      }
      const pick = votePlate(v.reads);
      // one or two reads: keep the best; three or more that never agree: the plate is unreadable, nothing is saved
      if (pick && (pick.votes >= CONFIRM_VOTES || v.reads.filter((r) => r.plate.valid).length <= 2)) await this.saveOnce(v, pick);
    });
  }

  private async saveOnce(v: Vehicle, pick: { plate: RecognizedPlate; frame: Decoded }) {
    this.recent = this.recent.filter((r) => this.lastT - r.t <= DEDUP_S);
    const dup = this.recent.find((r) => r.norm === pick.plate.norm);
    if (dup) {
      dup.t = this.lastT; // still around: keep it fresh
      v.saved = dup.saved;
      return;
    }
    v.saved = await this.save(pick.frame, pick.plate, v.ocrMs);
    this.recent.push({ norm: pick.plate.norm, t: this.lastT, saved: v.saved });
    this.newlySaved.push(v.saved);
  }

  /** Background reads run one after another; an error is logged, never thrown at a frame */
  private chain(job: () => Promise<void>) {
    const run = (this.ocr ?? Promise.resolve()).then(job).catch((e) => console.error("camera read failed", e));
    const p = run.finally(() => {
      if (this.ocr === p) this.ocr = null;
    });
    return p;
  }
}

const rejected = (v: Vehicle) => v.tries >= 2 && !v.reads.some((r) => r.plate.valid);

// ---------- sessions ----------

const sessions = new Map<string, CameraSession>();

export function openSession(userId: number, engine: CameraEngine, save: SaveFn) {
  const s = new CameraSession(userId, engine, save);
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string, user: { id: number }) {
  const s = sessions.get(id);
  if (!s || s.userId !== user.id) throw new HttpError(404, "Phiên camera đã kết thúc");
  return s;
}

export async function closeSession(s: CameraSession) {
  sessions.delete(s.id);
  return s.close();
}

// a closed tab never says goodbye: close sessions that stopped sending frames
setInterval(() => {
  for (const s of sessions.values()) if (Date.now() - s.lastActive > IDLE_MS) closeSession(s).catch((e) => console.error(e));
}, 10_000).unref();
