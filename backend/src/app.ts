// Express application (docs 8.1), separate from index.ts so tests can mount it with Supertest.
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.ts";
import { requireAuth, requireRole } from "./middlewares/auth.ts";
import { errorHandler, notFound } from "./middlewares/error.ts";
import { authRouter } from "./routes/auth.ts";
import { recognizeRouter } from "./routes/recognize.ts";
import { detectionsRouter } from "./routes/detections.ts";
import { platesRouter } from "./routes/plates.ts";
import { listsRouter } from "./routes/lists.ts";
import { statsRouter } from "./routes/stats.ts";
import { usersRouter } from "./routes/users.ts";
import { UPLOAD_URL, verifySignedUrl } from "./services/storage.ts";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind nginx in Docker (rate limit uses the client IP)
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 1000, standardHeaders: true, legacyHeaders: false }));

  // uploaded images: random UUID names (docs 8.3) + signed, expiring URLs
  app.use(UPLOAD_URL, verifySignedUrl, express.static(config.uploadDir, { fallthrough: false, maxAge: "1h" }));

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
  return app;
}
