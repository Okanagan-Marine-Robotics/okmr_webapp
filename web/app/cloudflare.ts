// Helper to bind Cloudflare D1 (`DB`) and Workers KV (`UPLOADS_KV`) in Next.js
// Server Components, Server Actions, and Route Handlers when deployed on
// Cloudflare Workers / Pages.
// Note: `@okmr_webapp/db` and `@okmr_webapp/storage` also auto-detect the
// OpenNext `Symbol.for("__cloudflare-context__")` global automatically.

import { setD1Database, type D1DatabaseLike } from "@okmr_webapp/db";
import { setUploadsKv, type KvNamespaceLike } from "@okmr_webapp/storage";

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");

export interface WebCloudflareEnv {
  DB?: D1DatabaseLike;
  UPLOADS_KV?: KvNamespaceLike;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_REQUIRED_ROLE_IDS?: string;
  DISCORD_LEAD_ROLE_IDS?: string;
  AUTH_SECRET?: string;
  AUTH_URL?: string;
  CLUB_TIMEZONE?: string;
}

export function initCloudflareBindings(explicitEnv?: WebCloudflareEnv): void {
  const cfCtx = (
    globalThis as unknown as {
      [CLOUDFLARE_CONTEXT_SYMBOL]?: { env?: WebCloudflareEnv };
    }
  )[CLOUDFLARE_CONTEXT_SYMBOL];

  const env = explicitEnv ?? cfCtx?.env;
  if (!env) return;

  if (env.DB) {
    setD1Database(env.DB);
  }
  setUploadsKv(env.UPLOADS_KV);
}
