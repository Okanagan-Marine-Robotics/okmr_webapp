import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getPlatformProxy } from "wrangler";
import { PrismaD1Adapter, type D1DatabaseLike, type D1PreparedStatementLike } from "./d1-adapter.ts";

const require = createRequire(import.meta.url);
const migrationsDir = join(import.meta.dirname, "../../prisma/migrations");
const UNSAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER) + 2n;

interface SqlQuery {
  sql: string;
  args: unknown[];
  argTypes: unknown[];
}

interface SqlResult {
  rows: unknown[][];
}

interface Queryable {
  queryRaw(query: SqlQuery): Promise<SqlResult>;
}

function sqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) => part.replace(/--[^\n]*/g, "").trim())
    .filter((part) => part.length > 0);
}

function recordingDatabase(db: D1DatabaseLike): D1DatabaseLike & { bound: unknown[][] } {
  const bound: unknown[][] = [];
  return {
    bound,
    prepare(sql: string): D1PreparedStatementLike {
      const stmt = db.prepare(sql);
      return {
        bind(...values: unknown[]) {
          bound.push(values);
          return stmt.bind(...values);
        },
        raw: ((options?: { columnNames?: boolean }) => stmt.raw(options as never)) as D1PreparedStatementLike["raw"],
        run: () => stmt.run(),
        all: () => stmt.all(),
      };
    },
    batch: (statements) => db.batch(statements),
    exec: (query) => db.exec(query),
  };
}

function loadWasmPrismaClient(): new (options: { adapter: PrismaD1Adapter }) => {
  seen: { findMany(args: { where: { userId: string } }): Promise<Array<{ userId: string; key: string }>> };
  team: { findMany(args: { select: { id: true; name: true; parentId: true } }): Promise<unknown[]> };
  task: { findMany(args: { select: { teamId: true; createdAt: true } }): Promise<Array<{ teamId: string; createdAt: Date }>> };
  meeting: { findMany(args: { select: { teamId: true; createdAt: true } }): Promise<unknown[]> };
  ticket: { findMany(args: { select: { type: true; createdAt: true } }): Promise<unknown[]> };
  devLog: { findMany(args: { select: { teamId: true; createdAt: true } }): Promise<unknown[]> };
  $disconnect(): Promise<void>;
} {
  const generatedDir = join(import.meta.dirname, "../../node_modules/.prisma/client");
  const wasmPath = join(generatedDir, "query_engine_bg.wasm");
  const runtimePath = join(generatedDir, "query_engine_bg.js");
  let source = readFileSync(join(generatedDir, "wasm.js"), "utf8");
  source = source.replace(
    "require('./query_engine_bg.js')",
    `require(${JSON.stringify(runtimePath)})`,
  );
  source = source.replace(
    /getQueryEngineWasmModule: async \(\) => \{[\s\S]*?\n  \}/,
    `getQueryEngineWasmModule: async () => {
      const fs = require("fs");
      return WebAssembly.compile(fs.readFileSync(${JSON.stringify(wasmPath)}));
    }`,
  );
  const out = join(generatedDir, "wasm-d1-regression.cjs");
  writeFileSync(out, source);
  return require(out).PrismaClient;
}

test("D1 rejects bigint 0 and the adapter binds safe integers as numbers", async () => {
  const dir = join(tmpdir(), `okmr-d1-adapter-${crypto.randomUUID()}`);
  mkdirSync(dir);
  writeFileSync(
    join(dir, "worker.js"),
    "export default { async fetch() { return new Response('ok'); } };\n",
  );
  writeFileSync(
    join(dir, "wrangler.toml"),
    [
      'name = "okmr-d1-adapter-fixture"',
      'compatibility_date = "2026-11-08"',
      'compatibility_flags = ["nodejs_compat"]',
      'main = "worker.js"',
      "",
      "[[d1_databases]]",
      'binding = "DB"',
      'database_name = "okmr-d1-adapter-fixture"',
      "",
    ].join("\n"),
  );

  const proxy = await getPlatformProxy<{ DB: D1DatabaseLike }>({
    configPath: join(dir, "wrangler.toml"),
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });
  const generatedWasm = join(import.meta.dirname, "../../node_modules/.prisma/client/wasm-d1-regression.cjs");

  try {
    const db = proxy.env.DB;
    let direct: Error | undefined;
    try {
      await db.prepare("SELECT ? AS n").bind(0n).raw();
    } catch (error) {
      direct = error as Error;
    }
    assert.ok(direct);
    assert.match(direct.message, /D1_TYPE_ERROR: Type 'bigint' not supported for value '0'/);
    const numeric = await db.prepare("SELECT ? AS n").bind(0).raw();
    assert.deepEqual(numeric, [[0]]);
    assert.equal(typeof numeric[0][0], "number");

    for (const file of readdirSync(migrationsDir).filter((name) => /^\d/.test(name)).sort()) {
      const sql = readFileSync(join(migrationsDir, file, "migration.sql"), "utf8");
      for (const statement of sqlStatements(sql)) {
        await db.exec(statement.replace(/\s+/g, " "));
      }
    }

    const recorded = recordingDatabase(db);
    const connection = (await new PrismaD1Adapter(recorded).connect()) as unknown as Queryable;

    recorded.bound.length = 0;
    const zero = await connection.queryRaw({ sql: "SELECT ? AS n", args: [0n], argTypes: [] });
    assert.deepEqual(recorded.bound, [[0]]);
    assert.equal(typeof recorded.bound[0][0], "number");
    assert.deepEqual(zero.rows, [[0]]);

    for (const value of [-1n, 1n, BigInt(Number.MAX_SAFE_INTEGER), BigInt(Number.MIN_SAFE_INTEGER)]) {
      recorded.bound.length = 0;
      const result = await connection.queryRaw({ sql: "SELECT ? AS n", args: [value], argTypes: [] });
      assert.equal(recorded.bound[0][0], Number(value));
      assert.equal(typeof recorded.bound[0][0], "number");
      assert.deepEqual(result.rows, [[Number(value)]]);
    }

    recorded.bound.length = 0;
    await assert.rejects(
      () => connection.queryRaw({ sql: "SELECT ? AS n", args: [UNSAFE_BIGINT], argTypes: [] }),
      (error: Error) => {
        assert.match(error.message, new RegExp(UNSAFE_BIGINT.toString()));
        assert.match(error.message, /outside the safe integer range/);
        return true;
      },
    );
    assert.deepEqual(recorded.bound, []);

    const tooSmall = BigInt(Number.MIN_SAFE_INTEGER) - 1n;
    recorded.bound.length = 0;
    await assert.rejects(
      () => connection.queryRaw({ sql: "SELECT ? AS n", args: [tooSmall], argTypes: [] }),
      (error: Error) => {
        assert.match(error.message, new RegExp(tooSmall.toString()));
        return true;
      },
    );
    assert.deepEqual(recorded.bound, []);

    recorded.bound.length = 0;
    await connection.queryRaw({
      sql: "SELECT ? AS flag, ? AS missing, ? AS when_at, ? AS label",
      args: [false, undefined, new Date("2026-01-02T03:04:05.000Z"), "fixture"],
      argTypes: [],
    });
    assert.deepEqual(recorded.bound, [[0, null, "2026-01-02T03:04:05.000Z", "fixture"]]);

    const PrismaClient = loadWasmPrismaClient();
    const prisma = new PrismaClient({ adapter: new PrismaD1Adapter(recorded) });
    try {
      recorded.bound.length = 0;
      assert.deepEqual(await prisma.seen.findMany({ where: { userId: "fixture-user" } }), []);
      assert.deepEqual(await prisma.team.findMany({ select: { id: true, name: true, parentId: true } }), []);
      assert.deepEqual(await prisma.meeting.findMany({ select: { teamId: true, createdAt: true } }), []);
      assert.deepEqual(await prisma.ticket.findMany({ select: { type: true, createdAt: true } }), []);
      assert.deepEqual(await prisma.devLog.findMany({ select: { teamId: true, createdAt: true } }), []);
      assert.ok(recorded.bound.some((values) => values.includes(0) && values.every((value) => typeof value !== "bigint")));
      assert.equal(recorded.bound.some((values) => values.some((value) => typeof value === "bigint")), false);

      await db.exec(
        "INSERT INTO \"User\" (\"id\", \"discordId\", \"username\", \"createdAt\") VALUES ('fixture-user', 'fixture-discord', 'fixture', '2026-01-01T00:00:00.000Z')",
      );
      await db.exec(
        "INSERT INTO \"Team\" (\"id\", \"name\", \"discordChannelId\", \"createdAt\") VALUES ('fixture-team', 'Fixture', 'channel-1', '2026-01-01T00:00:00.000Z')",
      );
      await db.exec(
        "INSERT INTO \"Task\" (\"id\", \"title\", \"teamId\", \"createdById\", \"status\", \"importance\", \"createdAt\", \"updatedAt\") VALUES ('fixture-task', 'Fixture task', 'fixture-team', 'fixture-user', 'open', 'medium', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')",
      );
      await db.exec(
        "INSERT INTO \"Seen\" (\"id\", \"userId\", \"key\", \"seenAt\") VALUES ('fixture-seen', 'fixture-user', 'tasks', '2026-01-04T00:00:00.000Z')",
      );

      recorded.bound.length = 0;
      const seen = await prisma.seen.findMany({ where: { userId: "fixture-user" } });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].userId, "fixture-user");
      assert.equal(seen[0].key, "tasks");
      const tasks = await prisma.task.findMany({ select: { teamId: true, createdAt: true } });
      assert.equal(tasks.length, 1);
      assert.equal(tasks[0].teamId, "fixture-team");
      assert.ok(tasks[0].createdAt instanceof Date);
      assert.equal(tasks[0].createdAt.toISOString(), "2026-01-03T00:00:00.000Z");
      assert.equal(recorded.bound.some((values) => values.some((value) => typeof value === "bigint")), false);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    rmSync(generatedWasm, { force: true });
    await proxy.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});
