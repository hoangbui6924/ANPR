import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTime = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" });
const dateOnly = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });

export const fmt = {
  dateTime: (iso: string) => dateTime.format(new Date(iso)),
  dayMonth: (iso: string) => dateOnly.format(new Date(iso)),
  percent: (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`,
  number: (v: number) => v.toLocaleString("vi-VN"),
  ms: (v: number | null) => (v == null ? "—" : `${v} ms`),
};

export const VEHICLE_LABEL = { car: "Ô tô", motorbike: "Xe máy" } as const;
export const PLATE_TYPE_LABEL = { "1line": "Biển 1 dòng", "2line": "Biển 2 dòng" } as const;
