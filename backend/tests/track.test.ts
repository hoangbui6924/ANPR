// Video tracking: boxes in consecutive frames are linked into one track per plate
import { describe, expect, it } from "vitest";
import type { PlateBox } from "../src/recognition/detect.ts";
import { predict, Tracker } from "../src/recognition/track.ts";

const box = (x: number, y: number, w = 60, h = 20, conf = 0.8): PlateBox => ({ x1: x, y1: y, x2: x + w, y2: y + h, conf, type: "1line" });

describe("Tracker", () => {
  it("follows two moving plates as two tracks", () => {
    const tr = new Tracker(1);
    for (let i = 0; i < 10; i++) tr.update(i / 8, [box(100 + i * 15, 100), box(400 - i * 10, 300 + i * 5)]);
    const tracks = tr.flush();
    expect(tracks).toHaveLength(2);
    expect(tracks.map((t) => t.sightings.length)).toEqual([10, 10]);
  });

  it("keeps a fast plate whose boxes no longer overlap, using its velocity", () => {
    const tr = new Tracker(1);
    // moves 70 px per frame: more than the box width, so only the prediction overlaps the next box
    for (let i = 0; i < 6; i++) tr.update(i / 8, [box(i * 70, 50)]);
    expect(tr.flush()).toHaveLength(1);
  });

  it("bridges a short gap (missed detections) but closes a track unseen for longer than maxGap", () => {
    const tr = new Tracker(1);
    tr.update(0, [box(100, 100)]);
    tr.update(0.5, [box(102, 100)]); // gap of 0.5 s: same track
    expect(tr.update(1.0, [])).toHaveLength(0);
    const closed = tr.update(1.6, []); // 1.1 s since the last sighting
    expect(closed).toHaveLength(1);
    expect(closed[0].sightings).toHaveLength(2);
    expect(tr.flush()).toHaveLength(0);
  });

  it("tells which track a box of the last frame belongs to", () => {
    const tr = new Tracker(1);
    const a = box(100, 100);
    tr.update(0, [a]);
    const b = box(105, 101);
    tr.update(0.125, [b, box(500, 500)]);
    expect(tr.trackOf(b)).toBe(tr.trackOf(b));
    expect(tr.trackOf(b)!.sightings.map((s) => s.box)).toEqual([a, b]);
  });
});

describe("predict", () => {
  it("moves the last box by the velocity of the last two sightings", () => {
    const p = predict({ id: 1, sightings: [{ t: 0, box: box(0, 0) }, { t: 0.125, box: box(10, 4) }] }, 0.25);
    expect(p.x1).toBeCloseTo(20);
    expect(p.y1).toBeCloseTo(8);
  });
});
