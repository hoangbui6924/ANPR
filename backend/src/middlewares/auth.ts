// JWT auth + role check (docs 8.3: access token 15 min, refresh 7 days; roles admin / staff)
import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.ts";
import { HttpError } from "./error.ts";

export type Role = "admin" | "staff";
export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccess(u: AuthUser) {
  return jwt.sign({ sub: String(u.id), username: u.username, role: u.role }, config.jwtSecret, { expiresIn: config.accessTtl });
}
export function signRefresh(u: AuthUser) {
  return jwt.sign({ sub: String(u.id) }, config.jwtRefreshSecret, { expiresIn: config.refreshTtl });
}
export function verifyRefresh(token: string): number {
  const p = jwt.verify(token, config.jwtRefreshSecret) as jwt.JwtPayload;
  return Number(p.sub);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return next(new HttpError(401, "Chưa đăng nhập"));
  try {
    const p = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    req.user = { id: Number(p.sub), username: p.username, role: p.role };
    next();
  } catch {
    next(new HttpError(401, "Phiên đăng nhập đã hết hạn"));
  }
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) =>
    req.user?.role === role ? next() : next(new HttpError(403, "Bạn không có quyền thực hiện thao tác này"));
}
