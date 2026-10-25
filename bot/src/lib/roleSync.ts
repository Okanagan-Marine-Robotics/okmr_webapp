// Automatic two-way synchronization for combined Team x Discipline Discord roles
// (e.g. "AUV" + "Software" <-> "AUV Software") matched dynamically by role name.
//
// Works across both bot runtimes:
// - Node Gateway (`index.ts`): instant updates on GuildMemberAdd/GuildMemberUpdate
//   using cached guild roles (0 REST reads when already in sync) + 15m sweep.
// - Cloudflare Worker (`worker.ts`): stateless REST sweep on Cron Triggers with
//   `maxMutations` capping so invocations stay well within the 50-subrequest limit.

import { Events } from "discord.js";
import type { Client, GuildMember, PartialGuildMember } from "discord.js";
import {
  fetchGuildRoles,
  listGuildMembersPage,
  modifyGuildMemberRole,
} from "./discordRest.js";
import { isAllowedGuild } from "./security.js";
import { env } from "../env.js";

export const TEAM_ROLE_NAMES = ["AUV", "Hydrofoil"] as const;
export const DISCIPLINE_ROLE_NAMES = ["Software", "Electrical", "Mechanical"] as const;

// Keep Worker Cron / HTTP Interaction sweeps well below Cloudflare Free Tier's
// 50-subrequest limit (1 GET /roles + 1-3 GET /members + up to 25 writes <= 29).
export const WORKER_MAX_ROLE_MUTATIONS = 25;

const GATEWAY_STARTUP_DELAY_MS = 15_000;
const GATEWAY_RECONCILE_INTERVAL_MS = 15 * 60_000;
const MAX_MEMBER_PAGES = 50; // up to 50,000 members safety ceiling
const MAX_TRANSIENT_ERRORS_RECORDED = 5;

export interface CombinedRoleSpec {
  teamName: string;
  disciplineName: string;
  combinedName: string;
}

export const COMBINED_ROLE_SPECS: readonly CombinedRoleSpec[] = TEAM_ROLE_NAMES.flatMap(
  (teamName) =>
    DISCIPLINE_ROLE_NAMES.map((disciplineName) => ({
      teamName,
      disciplineName,
      combinedName: `${teamName} ${disciplineName}`,
    })),
);

export interface RoleLike {
  id: string;
  name: string;
  position?: number;
  managed?: boolean;
}

export interface ResolvedRoleRule extends CombinedRoleSpec {
  teamRoleId: string;
  disciplineRoleId: string;
  combinedRoleId: string;
}

export interface ResolvedRulesResult {
  activeRules: ResolvedRoleRule[];
  missingRoles: string[];
}

export interface MemberRoleDiff {
  toAdd: ResolvedRoleRule[];
  toRemove: ResolvedRoleRule[];
}

export type RoleSyncErrorReason =
  | "roles_fetch_failed"
  | "missing_members_intent"
  | "members_fetch_failed";

export interface RoleSyncSummary {
  ok: boolean;
  errorReason?: RoleSyncErrorReason;
  membersScanned: number;
  membersUpdated: number;
  rolesAdded: number;
  rolesRemoved: number;
  addedByRole: Record<string, number>;
  removedByRole: Record<string, number>;
  missingRoles: string[];
  permissionErrors: string[];
  transientErrors: string[];
  capped: boolean;
}

export interface RoleSyncOptions {
  maxMutations?: number;
  pageSize?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

export function normalizeRoleName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function isPreferredRole(candidate: RoleLike, existing: RoleLike): boolean {
  const candPos = candidate.position ?? 0;
  const existPos = existing.position ?? 0;
  if (candPos !== existPos) return candPos > existPos;
  try {
    return BigInt(candidate.id) > BigInt(existing.id);
  } catch {
    return candidate.id > existing.id;
  }
}

// Match the 2 team roles, 3 discipline roles, and 6 combined roles by normalized
// name. A rule is active ONLY when all three roles exist on the server, so a
// renamed/deleted base role never causes combined roles to be stripped.
export function resolveCombinedRoleRules(
  roles: Iterable<RoleLike>,
  guildId: string,
): ResolvedRulesResult {
  const byName = new Map<string, RoleLike>();

  for (const role of roles) {
    if (!role.id || !role.name) continue;
    if (role.id === guildId) continue; // skip @everyone
    if (role.managed === true) continue; // skip bot/integration managed roles
    const norm = normalizeRoleName(role.name);
    if (!norm || norm === "@everyone") continue;

    const prev = byName.get(norm);
    if (!prev || isPreferredRole(role, prev)) {
      byName.set(norm, role);
    }
  }

  const activeRules: ResolvedRoleRule[] = [];
  const missingSet = new Set<string>();

  for (const spec of COMBINED_ROLE_SPECS) {
    const teamRole = byName.get(normalizeRoleName(spec.teamName));
    const disciplineRole = byName.get(normalizeRoleName(spec.disciplineName));
    const combinedRole = byName.get(normalizeRoleName(spec.combinedName));

    if (!teamRole) missingSet.add(spec.teamName);
    if (!disciplineRole) missingSet.add(spec.disciplineName);
    if (!combinedRole) missingSet.add(spec.combinedName);

    if (teamRole && disciplineRole && combinedRole) {
      activeRules.push({
        ...spec,
        teamRoleId: teamRole.id,
        disciplineRoleId: disciplineRole.id,
        combinedRoleId: combinedRole.id,
      });
    }
  }

  return {
    activeRules,
    missingRoles: [...missingSet],
  };
}

export function computeMemberRoleDiff(
  memberRoleIds: Iterable<string>,
  activeRules: readonly ResolvedRoleRule[],
): MemberRoleDiff {
  const held = memberRoleIds instanceof Set ? memberRoleIds : new Set(memberRoleIds);
  const toAdd: ResolvedRoleRule[] = [];
  const toRemove: ResolvedRoleRule[] = [];

  for (const rule of activeRules) {
    const shouldHave = held.has(rule.teamRoleId) && held.has(rule.disciplineRoleId);
    const currentlyHas = held.has(rule.combinedRoleId);

    if (shouldHave && !currentlyHas) {
      toAdd.push(rule);
    } else if (!shouldHave && currentlyHas) {
      toRemove.push(rule);
    }
  }

  return { toAdd, toRemove };
}

// Serialize full-guild sweeps per guildId so manual commands (/syncroles, /resync)
// and background timers never fire overlapping sweeps concurrently.
const guildSyncLocks = new Map<string, Promise<unknown>>();

async function withGuildSyncLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
  const previous = guildSyncLocks.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  guildSyncLocks.set(guildId, next);
  try {
    return await next;
  } finally {
    if (guildSyncLocks.get(guildId) === next) {
      guildSyncLocks.delete(guildId);
    }
  }
}

function emptySummary(): RoleSyncSummary {
  return {
    ok: true,
    membersScanned: 0,
    membersUpdated: 0,
    rolesAdded: 0,
    rolesRemoved: 0,
    addedByRole: {},
    removedByRole: {},
    missingRoles: [],
    permissionErrors: [],
    transientErrors: [],
    capped: false,
  };
}

export async function syncGuildCombinedRoles(
  guildId: string,
  botToken: string,
  opts?: RoleSyncOptions,
): Promise<RoleSyncSummary> {
  return withGuildSyncLock(guildId, async () => {
    const summary = emptySummary();

    const roles = await fetchGuildRoles(guildId, botToken);
    if (!roles) {
      summary.ok = false;
      summary.errorReason = "roles_fetch_failed";
      return summary;
    }

    const { activeRules, missingRoles } = resolveCombinedRoleRules(roles, guildId);
    summary.missingRoles = missingRoles;

    const pageSize = Math.min(Math.max(opts?.pageSize ?? 1000, 1), 1000);
    const allMembers = [];
    let after: string | undefined;

    for (let pageIdx = 0; pageIdx < MAX_MEMBER_PAGES; pageIdx++) {
      const page = await listGuildMembersPage(guildId, botToken, {
        limit: pageSize,
        after,
      });

      if (!page.ok) {
        summary.ok = false;
        summary.errorReason =
          page.status === 401 || page.status === 403
            ? "missing_members_intent"
            : "members_fetch_failed";
        return summary;
      }

      allMembers.push(...page.members);
      if (page.members.length < pageSize) break;

      const lastId = page.members[page.members.length - 1]?.user?.id;
      if (!lastId || lastId === after) break;
      after = lastId;
    }

    const maxMutations = opts?.maxMutations;
    let mutationsAttempted = 0;
    const blockedRoleIds = new Set<string>();

    outer: for (const member of allMembers) {
      const userId = member.user?.id;
      if (!userId) continue;
      if (member.user?.bot === true) continue;
      if (member.pending === true) continue;

      summary.membersScanned++;
      if (activeRules.length === 0) continue;

      const diff = computeMemberRoleDiff(member.roles ?? [], activeRules);
      const pendingAdds = diff.toAdd.filter((r) => !blockedRoleIds.has(r.combinedRoleId));
      const pendingRemoves = diff.toRemove.filter((r) => !blockedRoleIds.has(r.combinedRoleId));

      if (pendingAdds.length === 0 && pendingRemoves.length === 0) continue;

      let memberChanged = false;

      const mutations: Array<{ method: "PUT" | "DELETE"; rule: ResolvedRoleRule }> = [
        ...pendingAdds.map((rule) => ({ method: "PUT" as const, rule })),
        ...pendingRemoves.map((rule) => ({ method: "DELETE" as const, rule })),
      ];

      for (const { method, rule } of mutations) {
        if (blockedRoleIds.has(rule.combinedRoleId)) continue;

        if (maxMutations !== undefined && mutationsAttempted >= maxMutations) {
          summary.capped = true;
          break outer;
        }

        mutationsAttempted++;
        const auditReason =
          method === "PUT"
            ? `Auto-assigned ${rule.combinedName} (${rule.teamName} + ${rule.disciplineName})`
            : `Auto-removed ${rule.combinedName} (missing ${rule.teamName} or ${rule.disciplineName})`;

        const result = await modifyGuildMemberRole(
          guildId,
          userId,
          rule.combinedRoleId,
          method,
          botToken,
          { auditReason, sleepFn: opts?.sleepFn },
        );

        if (result.ok) {
          memberChanged = true;
          if (method === "PUT") {
            summary.rolesAdded++;
            summary.addedByRole[rule.combinedName] =
              (summary.addedByRole[rule.combinedName] ?? 0) + 1;
          } else {
            summary.rolesRemoved++;
            summary.removedByRole[rule.combinedName] =
              (summary.removedByRole[rule.combinedName] ?? 0) + 1;
          }
          continue;
        }

        if (result.status === 403) {
          blockedRoleIds.add(rule.combinedRoleId);
          summary.permissionErrors.push(
            `Missing permission to manage "@${rule.combinedName}" — grant the bot **Manage Roles** and drag its role above **${rule.combinedName}** in Server Settings → Roles.`,
          );
        } else if (summary.transientErrors.length < MAX_TRANSIENT_ERRORS_RECORDED) {
          summary.transientErrors.push(
            `Failed ${method === "PUT" ? "adding" : "removing"} "${rule.combinedName}" for <@${userId}> (HTTP ${result.status || "network"}).`,
          );
        }
      }

      if (memberChanged) {
        summary.membersUpdated++;
      }
    }

    return summary;
  });
}

function formatRoleCountMap(counts: Record<string, number>): string {
  return Object.entries(counts)
    .map(([name, count]) => `\`${name}\` (×${count})`)
    .join(", ");
}

export function formatRoleSyncReport(summary: RoleSyncSummary): string {
  if (!summary.ok) {
    if (summary.errorReason === "missing_members_intent") {
      return (
        "⚠️ **Couldn't list server members (HTTP 401/403).**\n" +
        "Enable **Server Members Intent** in [Discord Developer Portal](https://discord.com/developers/applications) → **Bot** → **Privileged Gateway Intents**, then try again."
      );
    }
    if (summary.errorReason === "roles_fetch_failed") {
      return "⚠️ Couldn't read this server's roles from Discord. Check the bot token and server membership.";
    }
    return "⚠️ Couldn't fetch the server member list from Discord. Try again in a moment.";
  }

  const lines: string[] = [];

  if (summary.rolesAdded === 0 && summary.rolesRemoved === 0) {
    lines.push(
      `✅ Checked **${summary.membersScanned}** member${summary.membersScanned === 1 ? "" : "s"} — all combined roles are already in sync.`,
    );
  } else {
    lines.push(
      `✅ Updated **${summary.membersUpdated}** of **${summary.membersScanned}** member${summary.membersScanned === 1 ? "" : "s"}:`,
    );
    if (summary.rolesAdded > 0) {
      lines.push(
        `• **Assigned (${summary.rolesAdded}):** ${formatRoleCountMap(summary.addedByRole)}`,
      );
    }
    if (summary.rolesRemoved > 0) {
      lines.push(
        `• **Removed (${summary.rolesRemoved}):** ${formatRoleCountMap(summary.removedByRole)}`,
      );
    }
  }

  if (summary.capped) {
    lines.push(
      `ℹ️ Batch capped at ${WORKER_MAX_ROLE_MUTATIONS} updates for this request — run \`/syncroles\` again (or wait for the next 5-minute cron) to finish the rest.`,
    );
  }

  if (summary.missingRoles.length > 0) {
    const formatted = summary.missingRoles.map((r) => `\`${r}\``).join(", ");
    lines.push(
      `⚠️ **Skipped missing role(s) on this server:** ${formatted}. Create them in Server Settings → Roles to enable their combinations.`,
    );
  }

  for (const err of summary.permissionErrors) {
    lines.push(`⚠️ ${err}`);
  }

  for (const err of summary.transientErrors) {
    lines.push(`⚠️ ${err}`);
  }

  return lines.join("\n");
}

// Compact 1-2 line status summary appended to `/resync`.
export function formatRoleSyncBrief(summary: RoleSyncSummary): string {
  if (!summary.ok) {
    if (summary.errorReason === "missing_members_intent") {
      return "⚠️ Combined role sync skipped: enable **Server Members Intent** in Discord Developer Portal → Bot → Privileged Gateway Intents.";
    }
    return "⚠️ Combined role sync couldn't reach Discord right now (run `/syncroles` to retry).";
  }

  const parts: string[] = [
    `Synced combined roles across ${summary.membersScanned} member${summary.membersScanned === 1 ? "" : "s"} (+${summary.rolesAdded} assigned, -${summary.rolesRemoved} removed).`,
  ];

  if (summary.capped) {
    parts.push(`Batch limit reached; run \`/syncroles\` to finish remaining updates.`);
  }
  if (summary.missingRoles.length > 0) {
    parts.push(
      `Missing role(s): ${summary.missingRoles.map((r) => `\`${r}\``).join(", ")}.`,
    );
  }
  if (summary.permissionErrors.length > 0) {
    parts.push(summary.permissionErrors[0]);
  }

  return parts.join(" ");
}

function haveMemberRolesOrScreeningChanged(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
): boolean {
  if (oldMember.partial) return true;
  if (Boolean(oldMember.pending) !== Boolean(newMember.pending)) return true;

  const oldRoles = oldMember.roles.cache;
  const newRoles = newMember.roles.cache;
  if (oldRoles.size !== newRoles.size) return true;

  for (const roleId of newRoles.keys()) {
    if (!oldRoles.has(roleId)) return true;
  }
  return false;
}

async function syncSingleGatewayMember(
  member: GuildMember,
  botToken: string,
): Promise<void> {
  if (!isAllowedGuild(member.guild.id)) return;
  if (member.user.bot || member.pending) return;

  if (member.guild.roles.cache.size === 0) {
    await member.guild.roles.fetch().catch(() => null);
  }

  const roles: RoleLike[] = [];
  for (const r of member.guild.roles.cache.values()) {
    roles.push({
      id: r.id,
      name: r.name,
      position: r.position,
      managed: r.managed,
    });
  }

  const { activeRules } = resolveCombinedRoleRules(roles, member.guild.id);
  if (activeRules.length === 0) return;

  const { toAdd, toRemove } = computeMemberRoleDiff(
    member.roles.cache.keys(),
    activeRules,
  );
  if (toAdd.length === 0 && toRemove.length === 0) return;

  for (const rule of toAdd) {
    const res = await modifyGuildMemberRole(
      member.guild.id,
      member.id,
      rule.combinedRoleId,
      "PUT",
      botToken,
      {
        auditReason: `Auto-assigned ${rule.combinedName} (${rule.teamName} + ${rule.disciplineName})`,
      },
    );
    if (!res.ok) {
      console.warn(
        `Role sync: failed adding "${rule.combinedName}" to ${member.user.tag} (HTTP ${res.status}): ${res.detail}`,
      );
    }
  }

  for (const rule of toRemove) {
    const res = await modifyGuildMemberRole(
      member.guild.id,
      member.id,
      rule.combinedRoleId,
      "DELETE",
      botToken,
      {
        auditReason: `Auto-removed ${rule.combinedName} (missing ${rule.teamName} or ${rule.disciplineName})`,
      },
    );
    if (!res.ok) {
      console.warn(
        `Role sync: failed removing "${rule.combinedName}" from ${member.user.tag} (HTTP ${res.status}): ${res.detail}`,
      );
    }
  }
}

export function registerRoleSync(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    syncSingleGatewayMember(member, env.botToken).catch((err) =>
      console.error("GuildMemberAdd role sync error:", err),
    );
  });

  client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
    if (!isAllowedGuild(newMember.guild.id)) return;
    if (newMember.user.bot || newMember.pending) return;
    if (!haveMemberRolesOrScreeningChanged(oldMember, newMember)) return;

    syncSingleGatewayMember(newMember, env.botToken).catch((err) =>
      console.error("GuildMemberUpdate role sync error:", err),
    );
  });
}

export function startRoleSyncScheduler(guildId: string, botToken: string): void {
  const runSweep = async () => {
    try {
      const summary = await syncGuildCombinedRoles(guildId, botToken);
      if (!summary.ok) {
        console.warn(`Role sync sweep failed (${summary.errorReason}).`);
        return;
      }
      if (summary.rolesAdded > 0 || summary.rolesRemoved > 0) {
        console.log(
          `Role sync sweep: scanned ${summary.membersScanned} members (+${summary.rolesAdded} added, -${summary.rolesRemoved} removed).`,
        );
      }
      if (summary.permissionErrors.length > 0) {
        console.warn(`Role sync sweep permission warning: ${summary.permissionErrors[0]}`);
      }
    } catch (err) {
      console.error("Role sync scheduler error:", err);
    }
  };

  setTimeout(() => {
    void runSweep();
  }, GATEWAY_STARTUP_DELAY_MS);
  setInterval(() => {
    void runSweep();
  }, GATEWAY_RECONCILE_INTERVAL_MS);
  console.log("Combined role sync scheduler started (startup + every 15 minutes).");
}
