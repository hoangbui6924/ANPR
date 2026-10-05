// Environment configuration (docs 8.1: config.ts). Values come from backend/.env (node --env-file / tsx).
import path from "node:path";
import { z } from "zod";

const ROOT = path.resolve(import.meta.dirname, "..");

const env = z
  .object({
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),
    JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 characters"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    UPLOAD_DIR: z.string().default("uploads"),
    MODELS_DIR: z.string().default("models"),
  })
  .parse(process.env);

export const config = {
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  jwtRefreshSecret: env.JWT_REFRESH_SECRET,
  accessTtl: "15m", // docs 8.3
  refreshTtl: "7d",
  corsOrigin: env.CORS_ORIGIN.split(",").map((s) => s.trim()),
  uploadDir: path.resolve(ROOT, env.UPLOAD_DIR),
  modelsDir: path.resolve(ROOT, env.MODELS_DIR),
  maxUploadBytes: 5 * 1024 * 1024, // docs 8.3: JPG/PNG, max 5 MB
} as const;
