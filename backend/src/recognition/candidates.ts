// Tracked plates over many frames (video, live camera): keep each plate's best frames and vote on their reads.
import type { PlateBox } from "./detect.ts";
import type { Decoded } from "./image.ts";
import type { RecognizedPlate } from "./index.ts";
import { formatPlate } from "./postprocess.ts";

export interface Candidate {
  score: number;
  frame: Decoded;
  box: PlateBox;
}

/** Keeps the `max` best frames of each track: bigger, more confident plates read better */
export class Candidates {
  private byTrack = new Map<number, Candidate[]>();
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  add(trackId: number, frame: Decoded, box: PlateBox) {
    const score = box.conf * Math.sqrt((box.x2 - box.x1) * (box.y2 - box.y1));
    const list = this.byTrack.get(trackId) ?? [];
    if (list.length >= this.max && score <= list.at(-1)!.score) return;
    list.push({ score, frame, box });
    list.sort((a, b) => b.score - a.score).splice(this.max);
    this.byTrack.set(trackId, list);
  }

  get(trackId: number): Candidate[] {
    return this.byTrack.get(trackId) ?? [];
  }

  delete(trackId: number) {
    this.byTrack.delete(trackId);
  }
}

/**
 * The plate string read on most frames wins (ties: higher OCR confidence). Only valid VN plates vote:
 * with several reads of one vehicle, a track that never reads as a plate is something else (lane marking, sticker).
 * When no string was read twice, three or more reads of the same length vote character by character
 * (29C200980 + 29C200560 + 29D200560 -> 29C200560). `votes` = how many reads back the result (>= 2: agreed).
 */
export function votePlate<T extends { plate: RecognizedPlate }>(reads: T[]): (T & { votes: number }) | null {
  const valid = reads.filter((r) => r.plate.valid);
  if (!valid.length) return null;
  const count = (n: string) => valid.filter((r) => r.plate.norm === n).length;
  const best = [...valid].sort((a, b) => count(b.plate.norm) - count(a.plate.norm) || b.plate.ocrConf - a.plate.ocrConf)[0];
  const votes = count(best.plate.norm);
  if (votes >= 2) return { ...best, votes };

  const byChar = charVote(valid.map((r) => r.plate.norm));
  const f = byChar ? formatPlate(byChar.norm) : null;
  if (!byChar || !f?.valid) return { ...best, votes };
  // keep the frame / box / type of the read closest to the voted string
  const same = (n: string) => [...n].filter((c, i) => c === byChar.norm[i]).length;
  const base = [...valid].sort((a, b) => same(b.plate.norm) - same(a.plate.norm) || b.plate.ocrConf - a.plate.ocrConf)[0];
  return { ...base, plate: { ...base.plate, norm: byChar.norm, text: f.text, vehicle: f.vehicle }, votes: byChar.votes };
}

/** Per-position majority over the most common string length (>= 3 reads); every position needs a clear winner seen twice */
export function charVote(norms: string[]): { norm: string; votes: number } | null {
  const byLen = new Map<number, string[]>();
  for (const n of norms) byLen.set(n.length, [...(byLen.get(n.length) ?? []), n]);
  const group = [...byLen.values()].sort((a, b) => b.length - a.length)[0];
  if (!group || group.length < 3) return null;
  let norm = "", votes = Infinity;
  for (let i = 0; i < group[0].length; i++) {
    const c = new Map<string, number>();
    for (const n of group) c.set(n[i], (c.get(n[i]) ?? 0) + 1);
    const [top, second] = [...c.entries()].sort((a, b) => b[1] - a[1]);
    if (top[1] < 2 || (second && second[1] === top[1])) return null;
    norm += top[0];
    votes = Math.min(votes, top[1]);
  }
  return { norm, votes };
}
