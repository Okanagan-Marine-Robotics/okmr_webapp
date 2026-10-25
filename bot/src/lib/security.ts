// Guild fencing, Lead/Admin role checks, and channel visibility checks shared
// across Gateway (`discord.js`) and Cloudflare Worker (`HttpInteractionAdapter`) modes.

import { PermissionFlagsBits } from "discord.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { env } from "../env.js";

// Strict check that an interaction or event belongs to the configured OKMR guild.
export function isAllowedGuild(guildId: string | null | undefined): boolean {
  if (!guildId) return false;
  try {
    return guildId === env.guildId;
  } catch {
    // Fail closed if DISCORD_GUILD_ID is missing.
    return false;
  }
}

interface InteractionMemberLike {
  memberPermissions?: {
    has(permission: bigint): boolean;
  } | null;
  member?: {
    roles?: string[] | { cache?: Map<string, unknown> };
  } | null;
}

// Returns true when the invoking guild member is a Discord server admin/manager
// (`Administrator` or `ManageGuild`) OR holds one of `DISCORD_LEAD_ROLE_IDS`.
export function isMemberLeadOrAdmin(interaction: InteractionMemberLike): boolean {
  const perms = interaction.memberPermissions;
  if (
    perms?.has(PermissionFlagsBits.Administrator) ||
    perms?.has(PermissionFlagsBits.ManageGuild)
  ) {
    return true;
  }

  const leadRoles = env.leadRoleIds;
  if (leadRoles.size === 0) return false;

  const rawRoles = interaction.member?.roles;
  if (!rawRoles) return false;

  if (Array.isArray(rawRoles)) {
    return rawRoles.some((r) => leadRoles.has(r));
  }

  if ("cache" in rawRoles && rawRoles.cache) {
    for (const roleId of rawRoles.cache.keys()) {
      if (leadRoles.has(roleId)) return true;
    }
  }

  return false;
}

// Verify the invoking user has ViewChannel permission on a target channel when
// querying another channel's forms, logs, or meetings.
export function canUserViewChannel(
  interaction: ChatInputCommandInteraction,
  target: unknown,
): boolean {
  if (!target || typeof target !== "object") return false;
  const targetId = (target as { id?: string }).id;
  if (!targetId) return false;

  // Running in the current channel already implies Discord allowed the user here.
  if (targetId === interaction.channelId) return true;

  // Gateway GuildBasedChannel: check computed overwrites via `permissionsFor`.
  if (
    "permissionsFor" in target &&
    typeof (target as { permissionsFor?: unknown }).permissionsFor === "function"
  ) {
    const channelPerms = (
      target as {
        permissionsFor(user: string): { has(perm: bigint): boolean } | null;
      }
    ).permissionsFor(interaction.user.id);
    return Boolean(channelPerms?.has(PermissionFlagsBits.ViewChannel));
  }

  // API / Worker resolved channel: Discord attaches computed `permissions` bitfield string.
  if ("permissions" in target && typeof (target as { permissions?: unknown }).permissions === "string") {
    try {
      const bitfield = BigInt((target as { permissions: string }).permissions);
      return (bitfield & PermissionFlagsBits.ViewChannel) !== 0n;
    } catch {
      return false;
    }
  }

  return false;
}
