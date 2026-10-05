// API tests with Supertest (docs 11): auth, roles, signed images, lists, recognize, stats.
// Needs the database (DATABASE_URL in backend/.env); skipped automatically when it is not reachable.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MODELS = path.resolve(import.meta.dirname, "../models");
const haveModels = ["plate.onnx", "rec_ch_v4_server.onnx"].every((f) => fs.existsSync(path.join(MODELS, f)));

let dbOk = false;
try {
  const { prisma } = await import("../src/db.ts");
  await prisma.$queryRaw`SELECT 1`;
  dbOk = true;
} catch {
  dbOk = false;
}

describe.skipIf(!dbOk)("API", async () => {
  const { prisma } = await import("../src/db.ts");
  const { createApp } = await import("../src/app.ts");
  const { initRecognizer } = await import("../src/services/recognize.ts");
  const { ensureDirs } = await import("../src/services/storage.ts");
  const app = createApp();
  const suffix = Date.now().toString(36);
  const users = { admin: `t_admin_${suffix}`, staff: `t_staff_${suffix}` };
  const PASSWORD = "test-password-123";
  const tokens: Record<string, string> = {};
  const createdDetections: number[] = [];
  const plateNorm = `99Z${suffix.slice(-5).replace(/\D/g, "1").padStart(5, "1")}`;

  beforeAll(async () => {
    await ensureDirs();
    if (haveModels) await initRecognizer();
    const hash = await bcrypt.hash(PASSWORD, 4);
    await prisma.user.create({ data: { username: users.admin, fullName: "Test admin", role: "admin", passwordHash: hash } });
    await prisma.user.create({ data: { username: users.staff, fullName: "Test staff", role: "staff", passwordHash: hash } });
    for (const [k, u] of Object.entries(users)) {
      const r = await request(app).post("/api/auth/login").send({ username: u, password: PASSWORD });
      tokens[k] = r.body.accessToken;
    }
  }, 60_000);

  afterAll(async () => {
    for (const id of createdDetections) await request(app).delete(`/api/detections/${id}`).set("Authorization", `Bearer ${tokens.admin}`);
    await prisma.vehicleList.deleteMany({ where: { plateNorm } });
    await prisma.user.deleteMany({ where: { username: { in: Object.values(users) } } });
    await prisma.$disconnect();
  });

  const as = (who: "admin" | "staff") => ({ Authorization: `Bearer ${tokens[who]}` });

  it("health is public", async () => {
    expect((await request(app).get("/api/health")).body).toEqual({ ok: true });
  });

  it("rejects missing / wrong credentials", async () => {
    expect((await request(app).get("/api/detections")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ username: users.admin, password: "nope" })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({})).status).toBe(400);
  });

  it("logs in, returns the user and refreshes the access token", async () => {
    const r = await request(app).post("/api/auth/login").send({ username: users.admin, password: PASSWORD });
    expect(r.body.user).toMatchObject({ username: users.admin, role: "admin" });
    const me = await request(app).get("/api/auth/me").set(as("admin"));
    expect(me.body.username).toBe(users.admin);
    const ref = await request(app).post("/api/auth/refresh").send({ refreshToken: r.body.refreshToken });
    expect(ref.status).toBe(200);
    expect(ref.body.accessToken).toBeTruthy();
  });

  it("enforces roles: staff cannot manage users", async () => {
    expect((await request(app).get("/api/users").set(as("staff"))).status).toBe(403);
    expect((await request(app).get("/api/users").set(as("admin"))).status).toBe(200);
  });

  it("validates input with clear errors", async () => {
    const r = await request(app).post("/api/users").set(as("admin")).send({ username: "x", fullName: "", role: "boss", password: "1" });
    expect(r.status).toBe(400);
    expect(r.body.issues.length).toBeGreaterThan(0);
  });

  it("vehicle lists: add, reject duplicates, delete", async () => {
    const add = await request(app).post("/api/vehicle-lists").set(as("staff")).send({ plateText: plateNorm, kind: "black", note: "test" });
    expect(add.status).toBe(201);
    expect((await request(app).post("/api/vehicle-lists").set(as("staff")).send({ plateText: plateNorm, kind: "white" })).status).toBe(409);
    expect((await request(app).get("/api/vehicle-lists?kind=black").set(as("staff"))).body.some((e: { plateNorm: string }) => e.plateNorm === plateNorm)).toBe(true);
    expect((await request(app).delete(`/api/vehicle-lists/${add.body.id}`).set(as("staff"))).status).toBe(204);
  });

  it("rejects non-image uploads", async () => {
    const r = await request(app).post("/api/recognize").set(as("staff")).attach("image", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(r.status).toBe(400);
  });

  it.skipIf(!haveModels)("recognizes an image, serves signed image URLs, deletes as admin only", async () => {
    const r = await request(app).post("/api/recognize").set(as("staff")).attach("image", path.join(import.meta.dirname, "fixtures/car-1line.jpg"));
    expect(r.status).toBe(200);
    createdDetections.push(r.body.detectionId);
    expect(r.body.plates.map((p: { text: string }) => p.text)).toContain("56N-7186");

    const url: string = r.body.imageUrl;
    expect(url).toMatch(/\?exp=\d+&sig=/);
    expect((await request(app).get(url)).status).toBe(200);
    expect((await request(app).get(url.split("?")[0])).status).toBe(403);
    expect((await request(app).get(url.replace(/sig=./, "sig=Z"))).status).toBe(403);

    const found = await request(app).get(`/api/plates/search?q=56N7181`).set(as("staff")); // one wrong char (pg_trgm)
    expect(found.body.some((h: { plateNorm: string }) => h.plateNorm === "56N7186")).toBe(true);

    expect((await request(app).delete(`/api/detections/${r.body.detectionId}`).set(as("staff"))).status).toBe(403);
    expect((await request(app).delete(`/api/detections/${r.body.detectionId}`).set(as("admin"))).status).toBe(204);
    createdDetections.pop();
    expect((await request(app).get(url)).status).toBe(404);
  }, 60_000);

  it("stats return numbers for the last N days", async () => {
    const s = await request(app).get("/api/stats/summary").set(as("staff"));
    expect(typeof s.body.totalDetections).toBe("number");
    const d = await request(app).get("/api/stats/daily?days=7").set(as("staff"));
    expect(d.body).toHaveLength(7);
  });

  it("changes the own password", async () => {
    expect((await request(app).put("/api/auth/password").set(as("staff")).send({ currentPassword: "wrong", newPassword: "another-pass-1" })).status).toBe(400);
    expect((await request(app).put("/api/auth/password").set(as("staff")).send({ currentPassword: PASSWORD, newPassword: "another-pass-1" })).status).toBe(204);
    expect((await request(app).post("/api/auth/login").send({ username: users.staff, password: "another-pass-1" })).status).toBe(200);
  });
});
