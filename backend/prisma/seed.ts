// Creates the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD (backend/.env)
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.ts";

const username = process.env.ADMIN_USERNAME ?? "admin";
const password = process.env.ADMIN_PASSWORD;
if (!password || password.length < 8) throw new Error("Set ADMIN_PASSWORD (at least 8 characters) in backend/.env");

const existing = await prisma.user.findUnique({ where: { username } });
if (existing) {
  console.log(`user "${username}" already exists, nothing to do`);
} else {
  await prisma.user.create({ data: { username, fullName: "Quản trị viên", role: "admin", passwordHash: await bcrypt.hash(password, 12) } });
  console.log(`created admin "${username}"`);
}
await prisma.$disconnect();
