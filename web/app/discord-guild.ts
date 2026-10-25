// Edge- and Worker-compatible Discord guild membership & role verification.
// Uses pure Web standard `fetch` (no Prisma or Node `fs` imports) so it runs
// identically in Next.js Edge Middleware, Node Server, and Cloudflare Workers.

const DISCORD_API_BASE = "https://discord.com/api/v10";
export const DISCORD_SNOWFLAKE_RE = /^\d{15,22}$/;

const PERMISSION_ADMINISTRATOR = 1n << 3n;
const PERMISSION_MANAGE_GUILD = 1n << 5n;
const GUILD_META_TTL_MS = 5 * 60 * 1000;

const CLOUDFLARE_CONTEXT_SYMBOL = Symbol.for("__cloudflare-context__");

export function isDiscordSnowflake(value: string | null | undefined): value is string {
  return Boolean(value && DISCORD_SNOWFLAKE_RE.test(value));
}

export function getRuntimeEnv(name: string): string | undefined {
  const cfEnv = (
    globalThis as unknown as {
      [CLOUDFLARE_CONTEXT_SYMBOL]?: { env?: Record<string, unknown> };
    }
  )[CLOUDFLARE_CONTEXT_SYMBOL]?.env;

  const cfVal = cfEnv?.[name];
  if (typeof cfVal === "string" && cfVal.length > 0) {
    return cfVal;
  }

  if (typeof process !== "undefined" && process.env) {
    const procVal = process.env[name];
    if (typeof procVal === "string" && procVal.length > 0) {
      return procVal;
    }
  }

  return undefined;
}

export function parseRoleIds(csv: string | undefined): Set<string> {
  if (!csv) return new Set();
  const ids = csv
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(isDiscordSnowflake);
  return new Set(ids);
}

interface DiscordGuildMeta {
  ownerId: string;
  rolePermissions: Map<string, bigint>;
  expiresAt: number;
}

const guildMetaCache = new Map<string, DiscordGuildMeta>();

async function getGuildMeta(
  guildId: string,
  botToken: string,
): Promise<DiscordGuildMeta | null> {
  const now = Date.now();
  const cached = guildMetaCache.get(guildId);
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  try {
    const res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      cache: "no-store",
    });
    if (!res.ok) return cached ?? null;

    const data = (await res.json()) as {
      owner_id?: string;
      roles?: Array<{ id?: string; permissions?: string }>;
    };

    const rolePermissions = new Map<string, bigint>();
    for (const role of data.roles ?? []) {
      if (isDiscordSnowflake(role.id) && typeof role.permissions === "string") {
        try {
          rolePermissions.set(role.id, BigInt(role.permissions));
        } catch {
          // Ignore malformed permission bitfields.
        }
      }
    }

    const meta: DiscordGuildMeta = {
      ownerId: isDiscordSnowflake(data.owner_id) ? data.owner_id : "",
      rolePermissions,
      expiresAt: now + GUILD_META_TTL_MS,
    };
    guildMetaCache.set(guildId, meta);
    return meta;
  } catch {
    return cached ?? null;
  }
}

export type GuildCheckDenyReason =
  | "misconfigured"
  | "not_in_guild"
  | "pending_screening"
  | "missing_role"
  | "transient_error";

export type GuildMemberCheckResult =
  | {
      allowed: true;
      isLead: boolean;
      roles: string[];
      displayName: string | null;
    }
  | {
      allowed: false;
      definitive: boolean;
      reason: GuildCheckDenyReason;
    };

// Verify via the club bot token that `discordId` is an active member of the
// configured OKMR Discord server (`DISCORD_GUILD_ID`), satisfies optional
// `DISCORD_REQUIRED_ROLE_IDS`, and compute whether they hold Lead/Admin status.
export async function verifyGuildMember(
  discordId: string | null | undefined,
): Promise<GuildMemberCheckResult> {
  if (!isDiscordSnowflake(discordId)) {
    return { allowed: false, definitive: true, reason: "not_in_guild" };
  }

  const botToken = getRuntimeEnv("DISCORD_BOT_TOKEN");
  const guildId = getRuntimeEnv("DISCORD_GUILD_ID");
  if (!botToken || !isDiscordSnowflake(guildId)) {
    console.error(
      "Auth fence error: DISCORD_BOT_TOKEN and a valid DISCORD_GUILD_ID must be configured.",
    );
    return { allowed: false, definitive: true, reason: "misconfigured" };
  }

  let res: Response;
  try {
    res = await fetch(`${DISCORD_API_BASE}/guilds/${guildId}/members/${discordId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.warn("Discord guild member lookup network error:", err);
    return { allowed: false, definitive: false, reason: "transient_error" };
  }

  if (res.status === 404) {
    return { allowed: false, definitive: true, reason: "not_in_guild" };
  }
  if (res.status === 401 || res.status === 403) {
    console.error(`Discord guild member lookup unauthorized (${res.status}). Check DISCORD_BOT_TOKEN and bot guild membership.`);
    return { allowed: false, definitive: true, reason: "misconfigured" };
  }
  if (!res.ok) {
    console.warn(`Discord guild member lookup transient HTTP ${res.status}.`);
    return { allowed: false, definitive: false, reason: "transient_error" };
  }

  const member = (await res.json()) as {
    nick?: string | null;
    roles?: unknown[];
    pending?: boolean;
    user?: {
      username?: string;
      global_name?: string | null;
    };
  };

  // Block members who haven't completed Discord's Membership Screening rules gate.
  if (member.pending === true) {
    return { allowed: false, definitive: true, reason: "pending_screening" };
  }

  const memberRoles = Array.isArray(member.roles)
    ? member.roles.filter((r): r is string => typeof r === "string" && isDiscordSnowflake(r))
    : [];

  const leadRoleIds = parseRoleIds(getRuntimeEnv("DISCORD_LEAD_ROLE_IDS"));
  let isLead = memberRoles.some((roleId) => leadRoleIds.has(roleId));

  const guildMeta = await getGuildMeta(guildId, botToken);
  if (guildMeta) {
    if (guildMeta.ownerId === discordId) {
      isLead = true;
    } else if (!isLead) {
      let perms = guildMeta.rolePermissions.get(guildId) ?? 0n; // @everyone role
      for (const roleId of memberRoles) {
        perms |= guildMeta.rolePermissions.get(roleId) ?? 0n;
      }
      if ((perms & (PERMISSION_ADMINISTRATOR | PERMISSION_MANAGE_GUILD)) !== 0n) {
        isLead = true;
      }
    }
  }

  const requiredRoleIds = parseRoleIds(getRuntimeEnv("DISCORD_REQUIRED_ROLE_IDS"));
  if (
    requiredRoleIds.size > 0 &&
    !isLead &&
    !memberRoles.some((roleId) => requiredRoleIds.has(roleId))
  ) {
    return { allowed: false, definitive: true, reason: "missing_role" };
  }

  const displayName =
    member.nick ?? member.user?.global_name ?? member.user?.username ?? null;

  return {
    allowed: true,
    isLead,
    roles: memberRoles,
    displayName,
  };
}
