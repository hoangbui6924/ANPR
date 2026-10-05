import { describe, expect, it } from "vitest";
import { formatPlate, normalizePlate, plateRows } from "./plate";

describe("normalizePlate", () => {
  it("uppercases and strips separators", () => {
    expect(normalizePlate("51f-155.85")).toBe("51F15585");
    expect(normalizePlate(" 59-V2 453.87")).toBe("59V245387");
  });
  it("handles Vietnamese input (Đ is not decomposed by NFD)", () => {
    expect(normalizePlate("đ1")).toBe("D1");
    expect(normalizePlate("51Ă")).toBe("51A");
  });
});

describe("formatPlate", () => {
  it("formats cars and motorbikes", () => {
    expect(formatPlate("51F15585")).toEqual({ text: "51F-155.85", valid: true, vehicle: "car" });
    expect(formatPlate("59V245387")).toEqual({ text: "59-V2 453.87", valid: true, vehicle: "motorbike" });
    expect(formatPlate("30F5204").text).toBe("30F-5204");
  });
  it("flags invalid strings", () => {
    expect(formatPlate("ABC")).toEqual({ text: "ABC", valid: false, vehicle: null });
  });
});

describe("plateRows", () => {
  it("splits a 2-line plate into its rows", () => {
    expect(plateRows("59-V2 453.87", "2line")).toEqual(["59-V2", "453.87"]);
    expect(plateRows("29A-680.05", "2line")).toEqual(["29A-", "680.05"]);
  });
  it("keeps 1-line plates on one row", () => {
    expect(plateRows("51F-155.85", "1line")).toEqual(["51F-155.85"]);
  });
});
