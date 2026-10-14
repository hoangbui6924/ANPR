// Plate tracking across video frames: a box in the next frame that overlaps the predicted position of a track
// (last box moved by its recent velocity), or lies close to it, belongs to the same vehicle.
import type { PlateBox } from "./detect.ts";

export interface Sighting {
  t: number; // seconds from the start of the video
  box: PlateBox;
}

export interface Track {
  id: number;
  sightings: Sighting[];
}

const iou = (a: PlateBox, b: PlateBox) => {
  const i = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const u = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - i;
  return u > 0 ? i / u : 0;
};

/** Where the track's plate should be at time t (constant velocity from its last two sightings) */
export function predict(track: Track, t: number): PlateBox {
  const s = track.sightings, last = s.at(-1)!;
  if (s.length < 2) return last.box;
  const prev = s.at(-2)!, dt = last.t - prev.t;
  if (dt <= 0) return last.box;
  const k = (t - last.t) / dt;
  const dx = ((last.box.x1 + last.box.x2) / 2 - (prev.box.x1 + prev.box.x2) / 2) * k;
  const dy = ((last.box.y1 + last.box.y2) / 2 - (prev.box.y1 + prev.box.y2) / 2) * k;
  return { ...last.box, x1: last.box.x1 + dx, x2: last.box.x2 + dx, y1: last.box.y1 + dy, y2: last.box.y2 + dy };
}

/**
 * Match score of a new box against a track: IoU with the prediction, else a small score for a nearby box
 * (-1 = no match). "Nearby" is 1.5 plate sizes from the prediction, or 3 sizes for a track seen once: it has no
 * velocity yet, and a motorbike at 5 frames/s moves about twice its plate size between frames.
 */
function score(track: Track, box: PlateBox, t: number) {
  const p = predict(track, t);
  const o = iou(p, box);
  if (o > 0.05) return o;
  const size = Math.max(p.x2 - p.x1, p.y2 - p.y1) * (track.sightings.length < 2 ? 3 : 1.5);
  const dist = Math.hypot((p.x1 + p.x2 - box.x1 - box.x2) / 2, (p.y1 + p.y2 - box.y1 - box.y2) / 2);
  return dist < size ? 0.05 * (1 - dist / size) : -1;
}

export class Tracker {
  private active: Track[] = [];
  private nextId = 1;
  private owner = new Map<PlateBox, Track>(); // boxes of the last update -> their track

  private maxGap: number;

  /** maxGap: seconds a track may go unseen (missed detections, occlusion) before it is closed */
  constructor(maxGap = 1) {
    this.maxGap = maxGap;
  }

  /** Add one frame's detections; returns the tracks that just closed */
  update(t: number, boxes: PlateBox[]): Track[] {
    const pairs: { track: Track; box: PlateBox; s: number }[] = [];
    for (const track of this.active) {
      for (const box of boxes) {
        const s = score(track, box, t);
        if (s >= 0) pairs.push({ track, box, s });
      }
    }
    // greedy: best matches first, each track and each box used once
    const usedT = new Set<Track>();
    this.owner = new Map();
    for (const { track, box } of pairs.sort((a, b) => b.s - a.s)) {
      if (usedT.has(track) || this.owner.has(box)) continue;
      track.sightings.push({ t, box });
      usedT.add(track);
      this.owner.set(box, track);
    }
    for (const box of boxes) {
      if (this.owner.has(box)) continue;
      const track = { id: this.nextId++, sightings: [{ t, box }] };
      this.active.push(track);
      this.owner.set(box, track);
    }

    const closed = this.active.filter((x) => t - x.sightings.at(-1)!.t > this.maxGap);
    this.active = this.active.filter((x) => !closed.includes(x));
    return closed;
  }

  /** The track a box of the last update was assigned to */
  trackOf(box: PlateBox): Track | undefined {
    return this.owner.get(box);
  }

  /** Close every remaining track (end of video) */
  flush(): Track[] {
    const all = this.active;
    this.active = [];
    return all;
  }
}
