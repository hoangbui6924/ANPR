// Express server: API + uploaded images (docs 8.1). Models are loaded once before listening (docs 6.5).
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.ts";
import { prisma } from "./db.ts";
import { requireAuth, requireRole } from "./middlewares/auth.ts";
import { errorHandler, notFound } from "./middlewares/error.ts";
import { authRouter } from "./routes/auth.ts";
import { recognizeRouter } from "./routes/recognize.ts";
import { detectionsRouter } from "./routes/detections.ts";
import { platesRouter } from "./routes/plates.ts";
import { listsRouter } from "./routes/lists.ts";
import { statsRouter } from "./routes/stats.ts";
import { usersRouter } from "./routes/users.ts";
import { initRecognizer } from "./services/recognize.ts";
import { ensureDirs, UPLOAD_URL } from "./services/storage.ts";

const app = express();
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "100kb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false }));

// file names are random UUIDs (docs 8.3)
app.use(UPLOAD_URL, express.static(config.uploadDir, { fallthrough: false, maxAge: "7d" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/recognize", requireAuth, recognizeRouter);
app.use("/api/detections", requireAuth, detectionsRouter);
app.use("/api/plates", requireAuth, platesRouter);
app.use("/api/vehicle-lists", requireAuth, listsRouter);
app.use("/api/stats", requireAuth, statsRouter);
app.use("/api/users", requireAuth, requireRole("admin"), usersRouter);
app.use(notFound);
app.use(errorHandler);

await ensureDirs();
const t0 = performance.now();
await initRecognizer();
await prisma.$queryRaw`SELECT 1`;
console.log(`models loaded in ${Math.round(performance.now() - t0)} ms, database ok`);
app.listen(config.port, (err) => {
  if (err) {
    console.error(`cannot listen on port ${config.port}: ${err.message} (change PORT in backend/.env)`);
    process.exit(1);
  }
  console.log(`ANPR API on http://localhost:${config.port}`);
});
