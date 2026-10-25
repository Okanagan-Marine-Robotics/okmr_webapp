// Shared Prisma client for `@okmr_webapp/db`.
// Supports two execution modes seamlessly:
//   1. Cloudflare Workers / Pages: initialized with a Cloudflare D1 binding
//      (`setD1Database(env.DB)` or auto-detected via OpenNext's
//      `Symbol.for("__cloudflare-context__")`), using `PrismaD1Adapter`.
//   2. Local Node.js dev (`web:dev`, `bot:dev`): lazily loads the repo-root
//      `.env` and connects to local SQLite (`DATABASE_URL="file:./prisma/dev.db"`).

import { PrismaClient } from "@prisma/client";
import { PrismaD1Adapter } from "./d1-adapter.js";
import type { D1DatabaseLike } from "./d1-adapter.js";

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  d1Binding?: D1DatabaseLike;
  d1Prisma?: PrismaClient;
  envLoaded?: boolean;
  [CLOUDFLARE_CONTEXT_SYMBOL]?: {
    env?: {
      DB?: D1DatabaseLike;
      [key: string]: unknown;
    };
  };
};

function isCloudflareWorkers(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    ("WebSocketPair" in globalThis ||
      Boolean(globalForPrisma[CLOUDFLARE_CONTEXT_SYMBOL]?.env) ||
      (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers"))
  );
}

// Synchronously load repo-root .env in local Node.js when DATABASE_URL isn't set.
function ensureLocalEnvLoaded(): void {
  if (globalForPrisma.envLoaded || isCloudflareWorkers()) return;
  globalForPrisma.envLoaded = true;

  if (typeof process !== "undefined" && !process.env.DATABASE_URL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { fileURLToPath } = require("node:url") as typeof import("node:url");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dirname, resolve } = require("node:path") as typeof import("node:path");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { config } = require("dotenv") as typeof import("dotenv");
      const here = dirname(fileURLToPath(import.meta.url));
      config({ path: resolve(here, "../../.env") });
    } catch {
      // Ignore in edge/bundled environments where require or local .env is absent.
    }
  }
}

export function setD1Database(d1: D1DatabaseLike | undefined | null): PrismaClient | null {
  if (!d1) return null;
  if (globalForPrisma.d1Binding === d1 && globalForPrisma.d1Prisma) {
    return globalForPrisma.d1Prisma;
  }
  const adapter = new PrismaD1Adapter(d1);
  const client = new PrismaClient({
    adapter,
    log: ["error"],
  });
  globalForPrisma.d1Binding = d1;
  globalForPrisma.d1Prisma = client;
  return client;
}

export function getPrismaClient(): PrismaClient {
  const cfContextDb = globalForPrisma[CLOUDFLARE_CONTEXT_SYMBOL]?.env?.DB;
  if (cfContextDb) {
    const client = setD1Database(cfContextDb);
    if (client) return client;
  }

  if (globalForPrisma.d1Prisma) {
    return globalForPrisma.d1Prisma;
  }

  ensureLocalEnvLoaded();

  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log:
        typeof process !== "undefined" && process.env.NODE_ENV === "development"
          ? ["warn", "error"]
          : ["error"],
    });
  }

  return globalForPrisma.prisma;
}

// Transparent proxy so callers can keep `import { prisma } from "@okmr_webapp/db"`
// at module scope while resolving the active D1 or local SQLite client at call time.
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export { PrismaD1Adapter } from "./d1-adapter.js";
export type { D1DatabaseLike } from "./d1-adapter.js";
export * from "@prisma/client";
