// Unit tests: Vietnamese plate post-processing (docs 6.4, 11)
import { describe, expect, it } from "vitest";
import { clean, fixByPosition, formatPlate, postprocess } from "../src/recognition/postprocess.ts";

describe("clean", () => {
  it("keeps only uppercase letters and digits", () => {
    expect(clean("51f-155.85")).toBe("51F15585");
    expect(clean(" 59-V2 453.87 ")).toBe("59V245387");
    expect(clean("Đ1")).toBe("D1");
  });
});

describe("fixByPosition", () => {
  it("turns look-alike letters into digits where digits are expected", () => {
    expect(fixByPosition("5IF15585")).toBe("51F15585"); // I -> 1 in the province code
    expect(fixByPosition("51F1558S")).toBe("51F15585"); // S -> 5 in the number
    expect(fixByPosition("51F155B5")).toBe("51F15585"); // B -> 8
  });
  it("turns digits into letters at the series position", () => {
    expect(fixByPosition("518155B5")).toBe("51B15585"); // 8 -> B
  });
  it("leaves too-short strings alone", () => {
    expect(fixByPosition("51F1")).toBe("51F1");
  });
});

describe("formatPlate", () => {
  it("formats car plates (1 or 2 series letters, 4 or 5 digits)", () => {
    expect(formatPlate("51F15585")).toEqual({ text: "51F-155.85", valid: true, vehicle: "car" });
    expect(formatPlate("51LD12345")).toEqual({ text: "51LD-123.45", valid: true, vehicle: "car" });
    expect(formatPlate("30F5204")).toEqual({ text: "30F-5204", valid: true, vehicle: "car" });
  });
  it("formats motorbike plates (letter + digit series)", () => {
    expect(formatPlate("59V245387")).toEqual({ text: "59-V2 453.87", valid: true, vehicle: "motorbike" });
  });
  it("rejects strings that do not match the VN format", () => {
    expect(formatPlate("2C46748").valid).toBe(false);
    expect(formatPlate("ABC").valid).toBe(false);
  });
});

describe("postprocess (rows)", () => {
  it("single row = 1-line plate", () => {
    expect(postprocess(["51F-155.85"])).toMatchObject({ norm: "51F15585", text: "51F-155.85", valid: true });
  });
  it("2-line motorbike: the top row decides the series, so 52T7 + 6433 is not read as a car", () => {
    expect(postprocess(["52-T7", "6433"])).toMatchObject({ text: "52-T7 6433", vehicle: "motorbike", valid: true });
  });
  it("2-line car plate (top row = province + 1 letter)", () => {
    expect(postprocess(["29A", "680.05"])).toMatchObject({ text: "29A-680.05", vehicle: "car", valid: true });
  });
  it("fixes the series digit of a motorbike top row (59SZ -> 59-S2)", () => {
    expect(postprocess(["59SZ", "447.17"])).toMatchObject({ text: "59-S2 447.17", valid: true });
  });
  it("fixes look-alikes in the number row", () => {
    expect(postprocess(["59-V2", "4S3.B7"])).toMatchObject({ norm: "59V245387", valid: true });
  });
  it("marks unreadable plates as invalid", () => {
    expect(postprocess(["C6-C1", "475.15"]).valid).toBe(false);
    expect(postprocess([""]).valid).toBe(false);
  });
});
