// Voting over several reads of one tracked plate (video, live camera)
import { describe, expect, it } from "vitest";
import { charVote, votePlate } from "../src/recognition/candidates.ts";
import type { RecognizedPlate } from "../src/recognition/index.ts";

const read = (norm: string, ocrConf = 0.9, valid = true) => ({
  plate: { text: norm, norm, type: "2line", vehicle: "motorbike", detConf: 0.9, ocrConf, valid, bbox: [0, 0, 1, 1] } as RecognizedPlate,
});

describe("votePlate", () => {
  it("takes the string read most often", () => {
    expect(votePlate([read("56P5644"), read("56P5641", 0.99), read("56P5644")])).toMatchObject({ votes: 2, plate: { norm: "56P5644" } });
  });
  it("ignores reads that are not valid plates and gives null when none is", () => {
    expect(votePlate([read("171156", 0.9, false)])).toBeNull();
  });
  it("votes character by character when no string was read twice", () => {
    const v = votePlate([read("29C200980"), read("29C200560"), read("29D200560")])!;
    expect(v.plate.norm).toBe("29C200560");
    expect(v.plate.text).toBe("29-C2 005.60");
    expect(v.votes).toBe(2);
  });
  it("keeps a single best read (1 vote) when the reads disagree too much", () => {
    const v = votePlate([read("59G76174"), read("61A70774", 0.95), read("70G217174")])!;
    expect(v.votes).toBe(1);
    expect(v.plate.norm).toBe("61A70774");
  });
});

describe("charVote", () => {
  it("needs three reads of the same length and a clear winner at every position", () => {
    expect(charVote(["59P259107", "59P265167", "59P255167"])).toEqual({ norm: "59P255167", votes: 2 });
    expect(charVote(["29C200560", "29C200561"])).toBeNull();
    expect(charVote(["12A34567", "12B34567", "12C34567"])).toBeNull();
  });
});
