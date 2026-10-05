import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.ts";
import { requireAuth, signAccess, signRefresh, verifyRefresh, type Role } from "../middlewares/auth.ts";
import { HttpError } from "../middlewares/error.ts";
import { userDto } from "../services/dto.ts";

export const authRouter = Router();

// brute-force protection on login (docs 8.3)
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { message: "Thử đăng nhập quá nhiều lần, vui lòng đợi 15 phút" } });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { username, password } = z.object({ username: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, "Sai tên đăng nhập hoặc mật khẩu");
  }
  const auth = { id: user.id, username: user.username, role: user.role as Role };
  res.json({ accessToken: signAccess(auth), refreshToken: signRefresh(auth), user: userDto(user) });
});

authRouter.post("/refresh", async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  let id: number;
  try {
    id = verifyRefresh(refreshToken);
  } catch {
    throw new HttpError(401, "Phiên đăng nhập đã hết hạn");
  }
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || !user.active) throw new HttpError(401, "Tài khoản không còn hoạt động");
  res.json({ accessToken: signAccess({ id: user.id, username: user.username, role: user.role as Role }) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user || !user.active) throw new HttpError(401, "Tài khoản không còn hoạt động");
  res.json(userDto(user));
});
