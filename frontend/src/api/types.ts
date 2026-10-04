// Shapes follow the API in docs chapter 8.2 (POST /api/recognize example)

export type PlateType = "1line" | "2line";
export type VehicleType = "car" | "motorbike";
export type ListKind = "white" | "black";
export type Role = "admin" | "staff";
export type Source = "upload" | "webcam";

export interface ListMatch {
  kind: ListKind;
  note: string | null;
}

export interface PlateResult {
  text: string; // 51F-155.85
  norm: string; // 51F15585
  type: PlateType;
  vehicle: VehicleType | null;
  detConf: number;
  ocrConf: number;
  valid: boolean;
  bbox: [number, number, number, number]; // x1, y1, x2, y2 in original image pixels
  cropUrl: string | null;
  list: ListMatch | null;
}

export interface RecognizeResult {
  detectionId: number;
  imageUrl: string;
  processMs: number;
  plates: PlateResult[];
}

export interface Detection {
  id: number;
  imageUrl: string;
  source: Source;
  createdBy: string | null;
  processMs: number | null;
  createdAt: string; // ISO
  plates: PlateResult[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DetectionQuery {
  page?: number;
  pageSize?: number;
  q?: string; // plate, fuzzy
  from?: string; // yyyy-mm-dd
  to?: string;
}

export interface PlateSearchHit {
  plateText: string;
  plateNorm: string;
  score: number;
  detectionId: number;
  createdAt: string;
}

export interface VehicleListEntry {
  id: number;
  plateNorm: string;
  plateText: string;
  kind: ListKind;
  note: string | null;
  createdAt: string;
}

export interface StatsSummary {
  totalDetections: number;
  totalPlates: number;
  today: number;
  validRate: number; // 0..1
  motorbike: number;
  car: number;
  blacklistHits: number;
}

export interface DailyStat {
  date: string; // yyyy-mm-dd
  detections: number;
  plates: number;
}

export interface User {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: User;
}
