import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function notFound(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, "Không tìm thấy"));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err instanceof ZodError) {
    return res.status(400).json({ message: "Dữ liệu không hợp lệ", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: err.code === "LIMIT_FILE_SIZE" ? "Ảnh lớn hơn 5 MB" : err.message });
  }
  // Prisma unique constraint
  if (typeof err === "object" && err && (err as { code?: string }).code === "P2002") {
    return res.status(409).json({ message: "Dữ liệu đã tồn tại" });
  }
  // http-errors from express internals (e.g. express.static 404, malformed JSON body 400)
  const status = typeof err === "object" && err ? ((err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode) : undefined;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ message: status === 404 ? "Không tìm thấy" : "Yêu cầu không hợp lệ" });
  }
  console.error(err);
  res.status(500).json({ message: "Lỗi máy chủ" });
}
