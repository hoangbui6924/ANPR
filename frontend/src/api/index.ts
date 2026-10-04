// One place for every endpoint in docs 8.2. With VITE_USE_MOCK (default until the backend exists)
// the same functions are served by an in-memory mock with identical shapes.
import { request, toQuery, USE_MOCK } from "./client";
import { mockApi } from "./mock";
import type {
  DailyStat,
  Detection,
  DetectionQuery,
  ListKind,
  LoginResult,
  Paged,
  PlateSearchHit,
  RecognizeResult,
  Role,
  StatsSummary,
  User,
  VehicleListEntry,
} from "./types";

export type NewListEntry = { plateText: string; kind: ListKind; note?: string };
export type NewUser = { username: string; fullName: string; role: Role; password: string };

const realApi = {
  login: (username: string, password: string) =>
    request<LoginResult>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => request<User>("/api/auth/me"),

  recognize: (file: File) => {
    const body = new FormData();
    body.append("image", file);
    return request<RecognizeResult>("/api/recognize", { method: "POST", body });
  },

  detections: (q: DetectionQuery) => request<Paged<Detection>>(`/api/detections${toQuery(q)}`),
  detection: (id: number) => request<Detection>(`/api/detections/${id}`),
  deleteDetection: (id: number) => request<void>(`/api/detections/${id}`, { method: "DELETE" }),
  searchPlates: (q: string) => request<PlateSearchHit[]>(`/api/plates/search${toQuery({ q })}`),

  lists: (kind?: ListKind) => request<VehicleListEntry[]>(`/api/vehicle-lists${toQuery({ kind })}`),
  addListEntry: (e: NewListEntry) =>
    request<VehicleListEntry>("/api/vehicle-lists", { method: "POST", body: JSON.stringify(e) }),
  deleteListEntry: (id: number) => request<void>(`/api/vehicle-lists/${id}`, { method: "DELETE" }),

  statsSummary: () => request<StatsSummary>("/api/stats/summary"),
  statsDaily: (days = 14) => request<DailyStat[]>(`/api/stats/daily${toQuery({ days })}`),

  users: () => request<User[]>("/api/users"),
  addUser: (u: NewUser) => request<User>("/api/users", { method: "POST", body: JSON.stringify(u) }),
  updateUser: (id: number, patch: Partial<Pick<User, "fullName" | "role" | "active">>) =>
    request<User>(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
};

export type Api = typeof realApi;
export const api: Api = USE_MOCK ? mockApi : realApi;
export { USE_MOCK };
