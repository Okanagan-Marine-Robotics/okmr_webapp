import { EventEmitter } from "node:events";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Events, type Client } from "discord.js";
import {
  COMBINED_ROLE_SPECS,
  computeMemberRoleDiff,
  formatRoleSyncBrief,
  formatRoleSyncReport,
  normalizeRoleName,
  registerRoleSync,
  resolveCombinedRoleRules,
  syncGuildCombinedRoles,
  type RoleLike,
} from "./roleSync.js";
import { HttpInteractionAdapter, InteractionType } from "./httpInteraction.js";
import { syncroles } from "../commands/syncroles.js";

const GUILD_ID = "100000000000000001";
const BOT_TOKEN = "test-bot-token";

function buildFullGuildRoles(): RoleLike[] {
  return [
    { id: GUILD_ID, name: "@everyone", position: 0 },
    { id: "2001", name: "AUV", position: 10 },
    { id: "2002", name: "Hydrofoil", position: 10 },
    { id: "3001", name: "Software", position: 9 },
    { id: "3002", name: "Electrical", position: 9 },
    { id: "3003", name: "Mechanical", position: 9 },
    { id: "4001", name: "AUV Software", position: 5 },
    { id: "4002", name: "AUV Electrical", position: 5 },
    { id: "4003", name: "AUV Mechanical", position: 5 },
    { id: "4004", name: "Hydrofoil Software", position: 5 },
    { id: "4005", name: "Hydrofoil Electrical", position: 5 },
    { id: "4006", name: "Hydrofoil Mechanical", position: 5 },
  ];
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("roleSync pure rule resolution & diffing", () => {
  it("normalizes role names case-insensitively and collapses whitespace", () => {
    assert.equal(normalizeRoleName("  AUV   Software \n"), "auv software");
    assert.equal(normalizeRoleName("HYDROFOIL MECHANICAL"), "hydrofoil mechanical");
  });

  it("resolves all 6 Team x Discipline rules while ignoring managed and @everyone roles", () => {
    const roles: RoleLike[] = [
      { id: GUILD_ID, name: "AUV", position: 99 }, // @everyone id must be ignored
      { id: "9999", name: "AUV Software", position: 99, managed: true }, // managed bot role ignored
      { id: "2001", name: " auv ", position: 3 },
      { id: "20019", name: "AUV", position: 8 }, // higher position duplicate wins
      { id: "2002", name: "hydrofoil", position: 8 },
      { id: "3001", name: "SOFTWARE", position: 7 },
      { id: "3002", name: "Electrical", position: 7 },
      { id: "3003", name: "  Mechanical  ", position: 7 },
      { id: "4001", name: "auv   software", position: 4 },
      { id: "4002", name: "AUV Electrical", position: 4 },
      { id: "4003", name: "AUV Mechanical", position: 4 },
      { id: "4004", name: "Hydrofoil Software", position: 4 },
      { id: "4005", name: "Hydrofoil Electrical", position: 4 },
      { id: "4006", name: "Hydrofoil Mechanical", position: 4 },
    ];

    const { activeRules, missingRoles } = resolveCombinedRoleRules(roles, GUILD_ID);
    assert.equal(COMBINED_ROLE_SPECS.length, 6);
    assert.equal(activeRules.length, 6);
    assert.deepEqual(missingRoles, []);

    const auvSoft = activeRules.find((r) => r.combinedName === "AUV Software");
    assert.ok(auvSoft);
    assert.equal(auvSoft.teamRoleId, "20019");
    assert.equal(auvSoft.disciplineRoleId, "3001");
    assert.equal(auvSoft.combinedRoleId, "4001");
  });

  it("skips incomplete rules safely without stripping roles when a base or combined role is missing", () => {
    // Missing "Hydrofoil" base role and "AUV Mechanical" combined role
    const roles = buildFullGuildRoles().filter(
      (r) => r.name !== "Hydrofoil" && r.name !== "AUV Mechanical",
    );

    const { activeRules, missingRoles } = resolveCombinedRoleRules(roles, GUILD_ID);
    assert.deepEqual(
      activeRules.map((r) => r.combinedName),
      ["AUV Software", "AUV Electrical"],
    );
    assert.deepEqual(missingRoles, ["AUV Mechanical", "Hydrofoil"]);

    // A user holding Hydrofoil Software ("4004") must NOT have it removed when "Hydrofoil" role is missing!
    const diff = computeMemberRoleDiff(["3001", "4004"], activeRules);
    assert.deepEqual(diff.toAdd, []);
    assert.deepEqual(diff.toRemove, []);
  });

  it("computes two-way additions and removals across multiple teams and disciplines", () => {
    const { activeRules } = resolveCombinedRoleRules(buildFullGuildRoles(), GUILD_ID);

    // User switched from AUV ("2001") to Hydrofoil ("2002"), has Software ("3001") + Electrical ("3002"),
    // still holds stale "AUV Software" ("4001") and already holds "Hydrofoil Software" ("4004").
    const diff = computeMemberRoleDiff(
      ["2002", "3001", "3002", "4001", "4004"],
      activeRules,
    );

    assert.deepEqual(
      diff.toAdd.map((r) => r.combinedName),
      ["Hydrofoil Electrical"],
    );
    assert.deepEqual(
      diff.toRemove.map((r) => r.combinedName),
      ["AUV Software"],
    );

    // Once updated, re-evaluating produces an empty diff (echo-loop safe).
    const postUpdateDiff = computeMemberRoleDiff(
      ["2002", "3001", "3002", "4004", "4005"],
      activeRules,
    );
    assert.deepEqual(postUpdateDiff.toAdd, []);
    assert.deepEqual(postUpdateDiff.toRemove, []);
  });
});

describe("syncGuildCombinedRoles REST integration", () => {
  it("paginates members, skips bots and pending users, and applies PUT/DELETE mutations", async () => {
    const calls: Array<{ method: string; url: string; reason: string | null }> = [];

    const allMembers = [
      // Page 1
      { user: { id: "101", username: "alice" }, roles: ["2001", "3001"] }, // needs +AUV Software (4001)
      { user: { id: "102", username: "botty", bot: true }, roles: ["2001", "3001"] }, // bot -> skipped
      // Page 2
      { user: { id: "103", username: "newbie" }, pending: true, roles: ["2001", "3002"] }, // pending -> skipped
      { user: { id: "104", username: "bob" }, roles: ["2002", "4001"] }, // missing Software -> needs -AUV Software (4001)
      // Page 3 (final partial page)
      { user: { id: "105", username: "carol" }, roles: ["2002", "3003", "4006"] }, // already in sync -> 0 writes
    ];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      calls.push({
        method,
        url,
        reason: headers.get("X-Audit-Log-Reason"),
      });

      if (method === "GET" && url.endsWith(`/guilds/${GUILD_ID}/roles`)) {
        return new Response(JSON.stringify(buildFullGuildRoles()), { status: 200 });
      }

      if (method === "GET" && url.includes(`/guilds/${GUILD_ID}/members`)) {
        const parsed = new URL(url);
        const limit = Number(parsed.searchParams.get("limit") ?? "1000");
        const after = parsed.searchParams.get("after");
        const startIdx = after
          ? allMembers.findIndex((m) => m.user.id === after) + 1
          : 0;
        const slice = allMembers.slice(startIdx, startIdx + limit);
        return new Response(JSON.stringify(slice), { status: 200 });
      }

      if (method === "PUT" || method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const summary = await syncGuildCombinedRoles(GUILD_ID, BOT_TOKEN, {
      pageSize: 2,
      sleepFn: async () => {},
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.membersScanned, 3); // alice, bob, carol (botty + pending newbie skipped)
    assert.equal(summary.membersUpdated, 2);
    assert.equal(summary.rolesAdded, 1);
    assert.equal(summary.rolesRemoved, 1);
    assert.deepEqual(summary.addedByRole, { "AUV Software": 1 });
    assert.deepEqual(summary.removedByRole, { "AUV Software": 1 });
    assert.equal(summary.capped, false);

    const writeCalls = calls.filter((c) => c.method === "PUT" || c.method === "DELETE");
    assert.equal(writeCalls.length, 2);
    assert.equal(writeCalls[0]?.method, "PUT");
    assert.ok(writeCalls[0]?.url.endsWith(`/guilds/${GUILD_ID}/members/101/roles/4001`));
    assert.ok(writeCalls[0]?.reason?.includes("AUV%20Software"));
    assert.equal(writeCalls[1]?.method, "DELETE");
    assert.ok(writeCalls[1]?.url.endsWith(`/guilds/${GUILD_ID}/members/104/roles/4001`));
  });

  it("circuit-breaks 403 roles once, retries 429, paces X-RateLimit-Remaining=0, and honors maxMutations", async () => {
    const sleeps: number[] = [];
    let put4006Attempts = 0;
    let put4001Calls = 0;

    const members = [
      { user: { id: "201" }, roles: ["2001", "3001"] }, // wants 4001 -> will 403
      { user: { id: "202" }, roles: ["2001", "3001"] }, // also wants 4001 -> must be skipped by circuit-breaker!
      { user: { id: "203" }, roles: ["2002", "3003"] }, // wants 4006 -> 429 once, then 204 with Remaining=0
      { user: { id: "204" }, roles: ["2002", "3001"] }, // wants 4004 -> should be capped by maxMutations=2!
    ];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (method === "GET" && url.endsWith(`/guilds/${GUILD_ID}/roles`)) {
        return new Response(JSON.stringify(buildFullGuildRoles()), { status: 200 });
      }
      if (method === "GET" && url.includes(`/guilds/${GUILD_ID}/members`)) {
        return new Response(JSON.stringify(members), { status: 200 });
      }
      if (method === "PUT" && url.endsWith("/roles/4001")) {
        put4001Calls++;
        return new Response(JSON.stringify({ code: 50013, message: "Missing Permissions" }), {
          status: 403,
        });
      }
      if (method === "PUT" && url.endsWith("/roles/4006")) {
        put4006Attempts++;
        if (put4006Attempts === 1) {
          return new Response(JSON.stringify({ retry_after: 1.2 }), {
            status: 429,
            headers: { "Retry-After": "1.2" },
          });
        }
        return new Response(null, {
          status: 204,
          headers: {
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset-After": "0.8",
          },
        });
      }
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const summary = await syncGuildCombinedRoles(GUILD_ID, BOT_TOKEN, {
      maxMutations: 2,
      sleepFn: async (ms) => {
        sleeps.push(ms);
      },
    });

    assert.equal(put4001Calls, 1); // user 202 skipped because 4001 returned 403 on user 201!
    assert.equal(put4006Attempts, 2); // retried after 429 and succeeded
    assert.equal(summary.rolesAdded, 1);
    assert.equal(summary.permissionErrors.length, 1);
    assert.equal(summary.capped, true); // user 204 deferred due to maxMutations=2
    assert.equal(sleeps.length, 2); // 1 sleep for 429 Retry-After (~1200ms) + 1 sleep for Remaining=0 (~850ms)
    assert.ok(formatRoleSyncReport(summary).includes("Manage Roles"));
    assert.ok(formatRoleSyncReport(summary).includes("Batch capped"));
  });

  it("surfaces actionable instructions when Server Members Intent is disabled (HTTP 403)", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/guilds/${GUILD_ID}/roles`)) {
        return new Response(JSON.stringify(buildFullGuildRoles()), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Missing Access" }), { status: 403 });
    }) as typeof fetch;

    const summary = await syncGuildCombinedRoles(GUILD_ID, BOT_TOKEN);
    assert.equal(summary.ok, false);
    assert.equal(summary.errorReason, "missing_members_intent");
    assert.ok(formatRoleSyncReport(summary).includes("Server Members Intent"));
    assert.ok(formatRoleSyncBrief(summary).includes("Server Members Intent"));
  });

  it("enforces admin/lead access on /syncroles and edits ephemeral reply with report", async () => {
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    process.env.DISCORD_BOT_TOKEN = BOT_TOKEN;

    // 1. Non-admin member is rejected immediately
    const unprivAdapter = new HttpInteractionAdapter(
      {
        id: "int-1",
        application_id: "app-1",
        type: InteractionType.APPLICATION_COMMAND,
        token: "tok-1",
        guild_id: GUILD_ID,
        channel_id: "chan-1",
        member: {
          user: { id: "501", username: "member" },
          roles: [],
          permissions: "0",
        },
        data: { name: "syncroles" },
      },
      BOT_TOKEN,
    );

    await syncroles.execute(unprivAdapter as unknown as Parameters<typeof syncroles.execute>[0]);
    const deniedRes = await unprivAdapter.getHttpResponse();
    const deniedJson = (await deniedRes.json()) as { data?: { content?: string } };
    assert.ok(deniedJson.data?.content?.includes("Only club leads or server admins"));

    // 2. Server Administrator runs /syncroles -> defers and patches webhook with sync summary
    let patchedContent = "";
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "GET" && url.endsWith(`/guilds/${GUILD_ID}/roles`)) {
        return new Response(JSON.stringify(buildFullGuildRoles()), { status: 200 });
      }
      if (method === "GET" && url.includes(`/guilds/${GUILD_ID}/members`)) {
        return new Response(
          JSON.stringify([{ user: { id: "601" }, roles: ["2001", "3002"] }]),
          { status: 200 },
        );
      }
      if (method === "PUT") {
        return new Response(null, { status: 204 });
      }
      if (method === "PATCH" && url.includes("/webhooks/app-1/tok-2/messages/@original")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { content?: string };
        patchedContent = body.content ?? "";
        return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const adminAdapter = new HttpInteractionAdapter(
      {
        id: "int-2",
        application_id: "app-1",
        type: InteractionType.APPLICATION_COMMAND,
        token: "tok-2",
        guild_id: GUILD_ID,
        channel_id: "chan-1",
        member: {
          user: { id: "502", username: "admin" },
          roles: [],
          permissions: String(1n << 3n), // Administrator bit
        },
        data: { name: "syncroles" },
      },
      BOT_TOKEN,
    );

    await syncroles.execute(adminAdapter as unknown as Parameters<typeof syncroles.execute>[0]);
    assert.ok(patchedContent.includes("AUV Electrical"));
    assert.ok(patchedContent.includes("Assigned (1)"));
  });

  it("handles real-time Gateway GuildMemberUpdate with zero REST reads and zero echo loops", async () => {
    process.env.DISCORD_GUILD_ID = GUILD_ID;
    process.env.DISCORD_BOT_TOKEN = BOT_TOKEN;

    const restCalls: Array<{ method: string; url: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      restCalls.push({ method: init?.method ?? "GET", url: String(input) });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const emitter = new EventEmitter();
    registerRoleSync(emitter as unknown as Client);

    const guildRolesCache = new Map(
      buildFullGuildRoles().map((r) => [
        r.id,
        { id: r.id, name: r.name, position: r.position ?? 0, managed: Boolean(r.managed) },
      ]),
    );

    const makeMember = (roleIds: string[], pending = false) => ({
      id: "777",
      partial: false,
      pending,
      user: { id: "777", bot: false, tag: "diver#0001" },
      guild: { id: GUILD_ID, roles: { cache: guildRolesCache } },
      roles: { cache: new Map(roleIds.map((id) => [id, guildRolesCache.get(id)])) },
    });

    // 1. Nickname/avatar update (identical roles & pending=false) -> 0 REST calls
    emitter.emit(
      Events.GuildMemberUpdate,
      makeMember(["2001", "3001"]),
      makeMember(["2001", "3001"]),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(restCalls.length, 0);

    // 2. User adds Software ("3001") while holding AUV ("2001") -> 1 PUT (0 GETs!)
    emitter.emit(
      Events.GuildMemberUpdate,
      makeMember(["2001"]),
      makeMember(["2001", "3001"]),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(restCalls.length, 1);
    assert.equal(restCalls[0]?.method, "PUT");
    assert.ok(restCalls[0]?.url.endsWith(`/guilds/${GUILD_ID}/members/777/roles/4001`));

    // 3. Follow-up Gateway echo event after "AUV Software" ("4001") is present -> 0 REST calls!
    emitter.emit(
      Events.GuildMemberUpdate,
      makeMember(["2001", "3001"]),
      makeMember(["2001", "3001", "4001"]),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(restCalls.length, 1);
  });
});
