// Environment configuration for the Discord bot.
// In Cloudflare Workers, secrets/vars are injected via `env` bindings and
// mirrored onto `process.env` per request. In local Node.js dev (`bot:dev` /
// `bot:deploy`), we lazily load the repo-root `.env`.

let localEnvLoaded = false;

export function isCloudflareWorkers(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    ("WebSocketPair" in globalThis ||
      (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers"))
  );
}

function ensureLocalEnv(): void {
  if (localEnvLoaded || isCloudflareWorkers()) return;
  localEnvLoaded = true;
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
    // Ignored in Workers/bundled environments.
  }
}

function required(name: string): string {
  ensureLocalEnv();
  const value = typeof process !== "undefined" ? process.env[name] : undefined;
  if (!value) {
    throw new Error(`Missing required env var ${name}. Set it in .env or Worker secrets.`);
  }
  return value;
}

export const env = {
  get botToken(): string {
    return required("DISCORD_BOT_TOKEN");
  },
  get clientId(): string {
    return required("DISCORD_CLIENT_ID");
  },
  get guildId(): string {
    return required("DISCORD_GUILD_ID");
  },
  get publicKey(): string | undefined {
    ensureLocalEnv();
    return typeof process !== "undefined" ? process.env.DISCORD_PUBLIC_KEY : undefined;
  },
  get leadRoleIds(): Set<string> {
    ensureLocalEnv();
    const raw = typeof process !== "undefined" ? process.env.DISCORD_LEAD_ROLE_IDS : undefined;
    if (!raw) return new Set();
    return new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{15,22}$/.test(s)),
    );
  },
};
