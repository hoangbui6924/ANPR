// Prisma 7 client with the node-postgres driver adapter
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.ts";
import { config } from "./config.ts";

export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
