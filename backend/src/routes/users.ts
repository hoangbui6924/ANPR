// User management, admin only (docs 8.2, 8.3)
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db.ts";
import { HttpError } from "../middlewares/error.ts";
import { userDto } from "../services/dto.ts";

export const usersRouter = Router();

const role = z.enum(["admin", "staff"]);

usersRouter.get("/", async (_req, res) => {
  const rows = await prisma.user.findMany({ orderBy: { id: "asc" } });
  res.json(rows.map(userDto));
});

usersRouter.post("/", async (req, res) => {
  const body = z
    .object({
      username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/, "Chỉ dùng chữ, số, . _ -"),
      fullName: z.string().trim().min(1).max(100),
      role,
      password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(72),
    })
    .parse(req.body);
  if (await prisma.user.findUnique({ where: { username: body.username } })) throw new HttpError(409, "Tên đăng nhập đã tồn tại");
  const user = await prisma.user.create({
    data: { username: body.username, fullName: body.fullName, role: body.role, passwordHash: await bcrypt.hash(body.password, 12) },
  });
  res.status(201).json(userDto(user));
});

usersRouter.put("/:id", async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const body = z
    .object({ fullName: z.string().trim().min(1).max(100).optional(), role: role.optional(), active: z.boolean().optional(), password: z.string().min(8).max(72).optional() })
    .parse(req.body);
  // an admin cannot lock themselves out or drop their own admin role
  if (id === req.user!.id && (body.active === false || (body.role && body.role !== "admin"))) {
    throw new HttpError(400, "Không thể khóa hoặc hạ quyền chính tài khoản đang đăng nhập");
  }
  const { password, ...rest } = body;
  const user = await prisma.user
    .update({ where: { id }, data: { ...rest, ...(password && { passwordHash: await bcrypt.hash(password, 12) }) } })
    .catch(() => null);
  if (!user) throw new HttpError(404, "Không tìm thấy người dùng");
  res.json(userDto(user));
});
