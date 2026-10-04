// Vietnamese plate normalization / formatting (same rules as docs 6.4, mirrored on the backend)
import type { VehicleType } from "@/api/types";

export const PLATE_RE = /^(\d{2})([A-Z]{1,2}|[A-Z]\d)(\d{4,5})$/;

/** "51f-155.85" -> "51F15585" */
export function normalizePlate(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

export function formatPlate(norm: string): { text: string; valid: boolean; vehicle: VehicleType | null } {
  const m = PLATE_RE.exec(norm);
  if (!m) return { text: norm, valid: false, vehicle: null };
  const [, province, series, num] = m;
  const n = num.length === 5 ? `${num.slice(0, 3)}.${num.slice(3)}` : num;
  const moto = /^[A-Z]\d$/.test(series);
  return {
    text: moto ? `${province}-${series} ${n}` : `${province}${series}-${n}`,
    valid: true,
    vehicle: moto ? "motorbike" : "car",
  };
}

/** Split a display string into the two rows of a 2-line plate: "59-V2 453.87" -> ["59-V2", "453.87"] */
export function plateRows(text: string, type: "1line" | "2line"): string[] {
  if (type === "1line") return [text];
  const i = text.indexOf(" ");
  if (i > 0) return [text.slice(0, i), text.slice(i + 1)];
  const j = text.indexOf("-");
  return j > 0 ? [text.slice(0, j + 1), text.slice(j + 1)] : [text];
}
