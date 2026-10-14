import { describe, expect, it } from "vitest";
import { boxAt, clock, contentRect, predictBox } from "./video";

const track = {
  boxes: [
    [1.0, 0.1, 0.1, 0.2, 0.2],
    [1.125, 0.2, 0.1, 0.3, 0.2],
    [3.0, 0.5, 0.5, 0.6, 0.6], // after a 1.875 s gap: not bridged
  ] as [number, number, number, number, number][],
};

describe("boxAt", () => {
  it("is hidden before the first sighting and after the hold time", () => {
    expect(boxAt(track, 0.5)).toBeNull();
    expect(boxAt(track, 3.5)).toBeNull();
  });
  it("interpolates between two close samples", () => {
    const b = boxAt(track, 1.0625)!;
    expect(b[0]).toBeCloseTo(0.15);
    expect(b[2]).toBeCloseTo(0.25);
  });
  it("holds the last box briefly across a long gap, then hides it", () => {
    expect(boxAt(track, 1.3)![0]).toBeCloseTo(0.2);
    expect(boxAt(track, 2.0)).toBeNull();
    expect(boxAt(track, 3.1)![0]).toBeCloseTo(0.5);
  });
});

describe("helpers", () => {
  it("formats the playback clock", () => {
    expect(clock(75.4)).toBe("1:15");
    expect(clock(5)).toBe("0:05");
  });
  it("finds the picture inside a letterboxed element", () => {
    const r = contentRect(1000, 1000, 1920, 1080);
    [r.x, r.y, r.w, r.h].forEach((v, i) => expect(v).toBeCloseTo([0, 218.75, 1000, 562.5][i]));
  });
});

describe("predictBox", () => {
  const a = { t: 10, box: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number] };
  const b = { t: 10.2, box: [0.2, 0.1, 0.3, 0.2] as [number, number, number, number] };
  it("moves the box on along its last velocity", () => {
    expect(predictBox([a, b], 10.3)![0]).toBeCloseTo(0.25);
  });
  it("stops extrapolating after 0.4 s and hides a plate not seen for 0.6 s", () => {
    expect(predictBox([a, b], 10.7)![0]).toBeCloseTo(0.4);
    expect(predictBox([a, b], 10.9)).toBeNull();
  });
  it("keeps a single sample in place", () => {
    expect(predictBox([b], 10.4)).toEqual(b.box);
  });
});
