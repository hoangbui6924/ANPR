// Video overlay helpers: where a tracked plate is at any playback time.
// The backend samples the video at a few frames per second; between two samples the box is interpolated,
// so it glides with the vehicle at the screen's refresh rate instead of jumping 8 times a second.
import type { VideoTrack } from "@/api/types";

export type Box = [number, number, number, number]; // x1, y1, x2, y2 in 0..1 of the frame

const HOLD_S = 0.3; // keep the last box this long after the final sighting
const MAX_GAP_S = 1; // samples further apart than this are not bridged (same as the backend tracker)
const LIVE_TIMEOUT_S = 0.6; // live camera: a plate missing from the answers for this long is gone
const MAX_AHEAD_S = 0.4; // live camera: never extrapolate further than this

/** The track's box at time t, or null when the plate is not on screen */
export function boxAt(track: Pick<VideoTrack, "boxes">, t: number): Box | null {
  const b = track.boxes;
  if (!b.length || t < b[0][0] - 0.05 || t > b[b.length - 1][0] + HOLD_S) return null;
  // last sample at or before t (binary search: tracks can hold thousands of samples)
  let lo = 0, hi = b.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (b[mid][0] <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = b[lo];
  if (a[0] > t) return a.slice(1) as Box; // a hair before the first sample
  const n = b[lo + 1];
  if (!n) return a.slice(1) as Box;
  if (n[0] - a[0] > MAX_GAP_S) return t - a[0] <= HOLD_S ? (a.slice(1) as Box) : null;
  const k = (t - a[0]) / (n[0] - a[0]);
  return [1, 2, 3, 4].map((j) => a[j] + (n[j] - a[j]) * k) as Box;
}

/**
 * Live camera: where a plate is now, from its last two server answers (t = capture time, client clock).
 * Answers arrive 5–8 times a second and ~0.1–0.3 s late, so the box keeps moving along its last velocity
 * (capped at MAX_AHEAD_S) instead of jumping at every answer and lagging behind the vehicle.
 */
export function predictBox(samples: { t: number; box: Box }[], now: number): Box | null {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > LIVE_TIMEOUT_S) return null;
  const prev = samples[samples.length - 2];
  if (!prev || last.t - prev.t <= 0 || last.t - prev.t > MAX_GAP_S) return last.box;
  const k = Math.min(now - last.t, MAX_AHEAD_S) / (last.t - prev.t);
  return [0, 1, 2, 3].map((j) => last.box[j] + (last.box[j] - prev.box[j]) * k) as Box;
}

/** "75.4" -> "1:15" */
export function clock(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** Rectangle the video picture occupies inside its element (object-fit: contain leaves bars) */
export function contentRect(elW: number, elH: number, vidW: number, vidH: number) {
  if (!vidW || !vidH) return { x: 0, y: 0, w: elW, h: elH };
  const s = Math.min(elW / vidW, elH / vidH);
  const w = vidW * s, h = vidH * s;
  return { x: (elW - w) / 2, y: (elH - h) / 2, w, h };
}
