// Vietnamese plate post-processing (docs 6.4): clean OCR text, fix look-alike characters by position, format.
// For 2-line plates the rows are kept apart: the top row is always province + series ("59-V2", "29A"),
// the bottom row is always the number ("453.87", "6433"). That removes the ambiguity of a merged string
// like "52T76433" (motorbike 52-T7 6433 vs car 52T-764.33).

export const PLATE_RE = /^(\d{2})([A-Z]{1,2}|[A-Z]\d)(\d{4,5})$/;
const TO_DIGIT: Record<string, string> = { O: "0", D: "0", Q: "0", U: "0", I: "1", L: "1", J: "1", T: "1", Z: "2", S: "5", G: "6", B: "8" };
const TO_LETTER: Record<string, string> = { "0": "D", "1": "T", "2": "Z", "4": "A", "5": "S", "6": "G", "8": "B" };
// look-alikes that become the series digit of a motorbike plate ("59-S2" read as "59SZ"); D/O/Q stay letters (51LD…)
const SERIES_DIGIT: Record<string, string> = { I: "1", J: "1", L: "1", T: "1", Z: "2", S: "5", G: "6", B: "8" };

export type Vehicle = "car" | "motorbike";

/** Uppercase, keep only 0-9 / A-Z */
export function clean(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

const digits = (s: string) => s.split("").map((c) => TO_DIGIT[c] ?? c).join("");

/** Single-line plate (or rows already merged): province digits, series letter, last 4 digits */
export function fixByPosition(norm: string): string {
  const s = norm.split("");
  if (s.length < 7) return norm;
  for (const i of [0, 1]) s[i] = TO_DIGIT[s[i]] ?? s[i];
  s[2] = TO_LETTER[s[2]] ?? s[2];
  for (let i = s.length - 4; i < s.length; i++) s[i] = TO_DIGIT[s[i]] ?? s[i];
  return s.join("");
}

function formatNumber(num: string) {
  return num.length === 5 ? `${num.slice(0, 3)}.${num.slice(3)}` : num;
}

export function formatPlate(norm: string): { text: string; valid: boolean; vehicle: Vehicle | null } {
  const m = PLATE_RE.exec(norm);
  if (!m) return { text: norm, valid: false, vehicle: null };
  const [, province, series, num] = m;
  const moto = /^[A-Z]\d$/.test(series);
  return {
    text: moto ? `${province}-${series} ${formatNumber(num)}` : `${province}${series}-${formatNumber(num)}`,
    valid: true,
    vehicle: moto ? "motorbike" : "car",
  };
}

/** Top row of a 2-line plate -> province + series */
function fixTopRow(top: string): string {
  const s = top.split("");
  for (const i of [0, 1]) if (s[i]) s[i] = TO_DIGIT[s[i]] ?? s[i];
  if (s[2]) s[2] = TO_LETTER[s[2]] ?? s[2];
  if (s.length === 4) s[3] = SERIES_DIGIT[s[3]] ?? s[3];
  return s.join("");
}

export interface PlateText {
  norm: string;
  text: string;
  valid: boolean;
  vehicle: Vehicle | null;
}

/** rows: OCR text per row (1 row for 1-line plates, 2 rows for 2-line plates) */
export function postprocess(rows: string[]): PlateText {
  if (rows.length < 2) {
    const norm = fixByPosition(clean(rows[0] ?? ""));
    return { norm, ...formatPlate(norm) };
  }
  const top = fixTopRow(clean(rows[0]));
  const num = digits(clean(rows.slice(1).join("")));
  const norm = top + num;
  const series = top.slice(2);
  const ok = /^\d{2}$/.test(top.slice(0, 2)) && /^([A-Z]{1,2}|[A-Z]\d)$/.test(series) && /^\d{4,5}$/.test(num);
  if (!ok) return { norm, ...formatPlate(fixByPosition(norm)), valid: false };
  const moto = /^[A-Z]\d$/.test(series);
  return {
    norm,
    text: moto ? `${top.slice(0, 2)}-${series} ${formatNumber(num)}` : `${top}-${formatNumber(num)}`,
    valid: true,
    vehicle: moto ? "motorbike" : "car",
  };
}
