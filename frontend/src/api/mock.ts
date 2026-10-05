// In-memory mock of the backend so the UI runs before the API exists (VITE_USE_MOCK=true).
// Every response has the same shape as the real endpoints in docs 8.2.
import { formatPlate, normalizePlate } from "@/lib/plate";
import type { Api, NewListEntry, NewUser } from "./index";
import type { DailyStat, Detection, PlateResult, PlateType, User, VehicleListEntry } from "./types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const round2 = (v: number) => Math.round(v * 100) / 100;

const PROVINCES = ["29", "30", "43", "51", "59", "60", "61", "65", "72", "89"];
const LETTERS = [..."ABCDEFGHKLMNPSTUVXYZ"];

function randomPlate(type: PlateType): string {
  const p = pick(PROVINCES);
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
  return type === "2line" ? `${p}${pick(LETTERS)}${1 + Math.floor(Math.random() * 9)}${digits(5)}` : `${p}${pick(LETTERS)}${digits(5)}`;
}

/** Placeholder scene (SVG data URL) with the plates drawn exactly where their bboxes are */
function sceneSvg(w: number, h: number, plates: PlateResult[]): string {
  const body = plates
    .map((p) => {
      const [x1, y1, x2, y2] = p.bbox;
      const bw = x2 - x1, bh = y2 - y1;
      const car = `<rect x="${x1 - bw * 1.2}" y="${y1 - bh * 3}" width="${bw * 3.4}" height="${bh * 4.2}" rx="${bh}" fill="#475569"/>`;
      const rows = formatPlate(p.norm).text.split(" ");
      const text =
        p.type === "2line" && rows.length === 2
          ? `<text x="${x1 + bw / 2}" y="${y1 + bh * 0.43}" font-size="${bh * 0.36}" text-anchor="middle" font-family="Arial" font-weight="700">${rows[0]}</text><text x="${x1 + bw / 2}" y="${y1 + bh * 0.88}" font-size="${bh * 0.36}" text-anchor="middle" font-family="Arial" font-weight="700">${rows[1]}</text>`
          : `<text x="${x1 + bw / 2}" y="${y1 + bh * 0.72}" font-size="${bh * 0.62}" text-anchor="middle" font-family="Arial" font-weight="700">${p.text}</text>`;
      return `${car}<rect x="${x1}" y="${y1}" width="${bw}" height="${bh}" rx="4" fill="#f8fafc" stroke="#0f172a" stroke-width="2"/>${text}`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#94a3b8"/><rect y="${h * 0.55}" width="${w}" height="${h * 0.45}" fill="#64748b"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makePlate(type: PlateType, bbox: PlateResult["bbox"], norm = randomPlate(type)): PlateResult {
  const f = formatPlate(norm);
  return {
    text: f.text,
    norm,
    type,
    vehicle: f.vehicle,
    detConf: round2(rnd(0.82, 0.98)),
    ocrConf: round2(rnd(0.7, 0.97)),
    valid: f.valid,
    bbox,
    cropUrl: null,
    list: null,
  };
}

// ---------- seed data ----------
let nextId = 1;
const now = Date.now();
const DAY = 86_400_000;

const users: User[] = [
  { id: 1, username: "admin", fullName: "Quản trị viên", role: "admin", active: true, createdAt: new Date(now - 30 * DAY).toISOString() },
  { id: 2, username: "staff", fullName: "Nhân viên bãi xe", role: "staff", active: true, createdAt: new Date(now - 20 * DAY).toISOString() },
];

const lists: VehicleListEntry[] = [
  { id: 1, plateNorm: "51F15585", plateText: "51F-155.85", kind: "black", note: "Xe báo mất cắp", createdAt: new Date(now - 5 * DAY).toISOString() },
  { id: 2, plateNorm: "59V245387", plateText: "59-V2 453.87", kind: "white", note: "Xe nhân viên", createdAt: new Date(now - 3 * DAY).toISOString() },
];
let nextListId = 3;

function listMatch(norm: string) {
  const e = lists.find((l) => l.plateNorm === norm);
  return e ? { kind: e.kind, note: e.note } : null;
}

const detections: Detection[] = [];
for (let i = 0; i < 64; i++) {
  const w = 960, h = 640;
  const type: PlateType = Math.random() < 0.6 ? "2line" : "1line";
  const pw = type === "1line" ? 190 : 110, ph = type === "1line" ? 44 : 92;
  const x = rnd(220, w - 220 - pw), y = rnd(330, h - 40 - ph);
  const norm = i === 5 ? "51F15585" : i === 9 ? "59V245387" : i % 17 === 3 ? "5IF1558" : randomPlate(type);
  const plate = makePlate(type, [Math.round(x), Math.round(y), Math.round(x + pw), Math.round(y + ph)], norm);
  plate.list = listMatch(norm);
  detections.push({
    id: nextId++,
    imageUrl: sceneSvg(w, h, [plate]),
    source: Math.random() < 0.8 ? "upload" : "webcam",
    createdBy: pick(["admin", "staff"]),
    processMs: Math.round(rnd(55, 140)),
    createdAt: new Date(now - i * rnd(0.15, 0.3) * DAY).toISOString(),
    plates: [plate],
  });
}

async function imageSize(file: File) {
  try {
    const bmp = await createImageBitmap(file);
    const s = { w: bmp.width, h: bmp.height };
    bmp.close();
    return s;
  } catch {
    return { w: 960, h: 640 };
  }
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

export const mockApi: Api = {
  async login(username, password) {
    await wait(400);
    const user = users.find((u) => u.username === username && u.active);
    if (!user || password.length < 1) throw new Error("Sai tên đăng nhập hoặc mật khẩu");
    return { accessToken: `mock.${user.id}`, refreshToken: "mock.refresh", user };
  },
  async me() {
    const id = Number(localStorage.getItem("anpr.accessToken")?.split(".")[1]);
    const user = users.find((u) => u.id === id);
    if (!user) throw new Error("Chưa đăng nhập");
    return user;
  },

  async changePassword(current, next) {
    await wait(300);
    if (!current) throw new Error("Mật khẩu hiện tại không đúng");
    if (next.length < 8) throw new Error("Mật khẩu mới tối thiểu 8 ký tự");
  },

  async recognize(file) {
    const started = performance.now();
    const { w, h } = await imageSize(file);
    await wait(rnd(500, 900));
    // pretend 1–2 plates were found in the lower half of the photo
    const count = Math.random() < 0.25 ? 2 : 1;
    const plates = Array.from({ length: count }, (_, k) => {
      const type: PlateType = Math.random() < 0.55 ? "2line" : "1line";
      const pw = w * (type === "1line" ? 0.2 : 0.12), ph = pw * (type === "1line" ? 0.24 : 0.78);
      const cx = count === 1 ? w * 0.5 : w * (0.3 + k * 0.4);
      const cy = h * rnd(0.6, 0.72);
      const plate = makePlate(type, [cx - pw / 2, cy - ph / 2, cx + pw / 2, cy + ph / 2].map(Math.round) as PlateResult["bbox"]);
      if (Math.random() < 0.15) Object.assign(plate, makePlate(type, plate.bbox, "51F15585"));
      plate.list = listMatch(plate.norm);
      return plate;
    });
    const det: Detection = {
      id: nextId++,
      imageUrl: URL.createObjectURL(file),
      source: "upload",
      createdBy: users[0].username,
      processMs: Math.round(performance.now() - started),
      createdAt: new Date().toISOString(),
      plates,
    };
    detections.unshift(det);
    return { detectionId: det.id, imageUrl: det.imageUrl, processMs: det.processMs ?? 0, plates };
  },

  async detections({ page = 1, pageSize = 10, q, from, to }) {
    await wait(250);
    const nq = q ? normalizePlate(q) : "";
    const items = detections.filter((d) => {
      const day = d.createdAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return !nq || d.plates.some((p) => p.norm.includes(nq));
    });
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
  },
  async detection(id) {
    await wait(150);
    const d = detections.find((x) => x.id === id);
    if (!d) throw new Error("Không tìm thấy lần nhận dạng");
    return d;
  },
  async deleteDetection(id) {
    await wait(200);
    const i = detections.findIndex((x) => x.id === id);
    if (i >= 0) detections.splice(i, 1);
  },
  async searchPlates(q) {
    await wait(200);
    const nq = normalizePlate(q);
    return detections
      .flatMap((d) => d.plates.map((p) => ({ d, p })))
      .filter(({ p }) => nq && p.norm.includes(nq))
      .slice(0, 20)
      .map(({ d, p }) => ({ plateText: p.text, plateNorm: p.norm, score: 1, detectionId: d.id, createdAt: d.createdAt }));
  },

  async lists(kind) {
    await wait(200);
    return lists.filter((l) => !kind || l.kind === kind);
  },
  async addListEntry(e: NewListEntry) {
    await wait(250);
    const norm = normalizePlate(e.plateText);
    if (lists.some((l) => l.plateNorm === norm)) throw new Error("Biển số này đã có trong danh sách");
    const entry: VehicleListEntry = {
      id: nextListId++,
      plateNorm: norm,
      plateText: formatPlate(norm).text,
      kind: e.kind,
      note: e.note || null,
      createdAt: new Date().toISOString(),
    };
    lists.unshift(entry);
    return entry;
  },
  async deleteListEntry(id) {
    await wait(200);
    const i = lists.findIndex((l) => l.id === id);
    if (i >= 0) lists.splice(i, 1);
  },

  async statsSummary() {
    await wait(250);
    const plates = detections.flatMap((d) => d.plates);
    const today = dayKey(Date.now());
    return {
      totalDetections: detections.length,
      totalPlates: plates.length,
      today: detections.filter((d) => d.createdAt.startsWith(today)).length,
      validRate: plates.length ? plates.filter((p) => p.valid).length / plates.length : 0,
      motorbike: plates.filter((p) => p.vehicle === "motorbike").length,
      car: plates.filter((p) => p.vehicle === "car").length,
      blacklistHits: plates.filter((p) => p.list?.kind === "black").length,
    };
  },
  async statsDaily(days = 14) {
    await wait(250);
    const out: DailyStat[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = dayKey(Date.now() - i * DAY);
      const ds = detections.filter((d) => d.createdAt.startsWith(key));
      out.push({ date: key, detections: ds.length, plates: ds.reduce((a, d) => a + d.plates.length, 0) });
    }
    return out;
  },

  async users() {
    await wait(200);
    return [...users];
  },
  async addUser(u: NewUser) {
    await wait(250);
    if (users.some((x) => x.username === u.username)) throw new Error("Tên đăng nhập đã tồn tại");
    const user: User = { id: users.length + 1, username: u.username, fullName: u.fullName, role: u.role, active: true, createdAt: new Date().toISOString() };
    users.push(user);
    return user;
  },
  async updateUser(id, patch) {
    await wait(200);
    const user = users.find((u) => u.id === id);
    if (!user) throw new Error("Không tìm thấy người dùng");
    Object.assign(user, patch);
    return { ...user };
  },
};
