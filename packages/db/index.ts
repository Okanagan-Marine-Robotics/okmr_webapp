// Shared Prisma client. Imported by BOTH the web app and the bot so they read
// and write the exact same database. A single client is reused across hot
// reloads (dev) to avoid exhausting database connections.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "@prisma/client";

// Load the repo-root .env so the bot (plain Node) gets DATABASE_URL etc.
// Next.js loads .env on its own, so this is a harmless no-op there.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env") });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export Prisma's generated types/enums so callers get one import path.
export * from "@prisma/client";
