// Cloudflare D1 SqlDriverAdapterFactory for Prisma 6.
// Implements the Prisma Driver Adapter interface directly against Cloudflare's
// `D1Database` binding (`env.DB`) with zero external runtime dependencies.

import type { SqlDriverAdapterFactory } from "@prisma/client/runtime/library";

export interface D1MetaLike {
  changes?: number;
  last_row_id?: number;
}

export interface D1ResultLike<T = Record<string, unknown>> {
  results?: T[];
  success: boolean;
  meta: D1MetaLike;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  raw(options: { columnNames: true }): Promise<[string[], ...unknown[][]] | []>;
  raw(options?: { columnNames?: false }): Promise<unknown[][]>;
  run(): Promise<D1ResultLike>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1ResultLike<T>[]>;
  exec(query: string): Promise<unknown>;
}

// Matches ColumnTypeEnum from @prisma/client/runtime/library
const ColumnTypeEnum = {
  Int32: 0,
  Int64: 1,
  Float: 2,
  Double: 3,
  Numeric: 4,
  Boolean: 5,
  Character: 6,
  Text: 7,
  Date: 8,
  Time: 9,
  DateTime: 10,
  Json: 11,
  Enum: 12,
  Bytes: 13,
} as const;

type ColumnType = (typeof ColumnTypeEnum)[keyof typeof ColumnTypeEnum];

interface SqlQuery {
  sql: string;
  args: Array<unknown>;
  argTypes: Array<{ scalarType: string; dbType?: string; arity: string }>;
}

interface SqlResultSet {
  columnTypes: Array<ColumnType>;
  columnNames: Array<string>;
  rows: Array<Array<unknown>>;
  lastInsertId?: string;
}

function cleanArg(arg: unknown): unknown {
  if (arg === undefined) return null;
  if (typeof arg === "boolean") return arg ? 1 : 0;
  if (arg instanceof Date) return arg.toISOString();
  return arg;
}

function inferColumnType(value: unknown): ColumnType {
  if (typeof value === "number") {
    return Number.isInteger(value) ? ColumnTypeEnum.Int64 : ColumnTypeEnum.Double;
  }
  if (typeof value === "bigint") {
    return ColumnTypeEnum.Int64;
  }
  if (typeof value === "boolean") {
    return ColumnTypeEnum.Boolean;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return ColumnTypeEnum.Bytes;
  }
  return ColumnTypeEnum.Text;
}

function inferColumnTypes(columnNames: string[], rows: unknown[][]): ColumnType[] {
  return columnNames.map((_, colIdx) => {
    for (const row of rows) {
      const cell = row[colIdx];
      if (cell !== null && cell !== undefined) {
        return inferColumnType(cell);
      }
    }
    return ColumnTypeEnum.Text;
  });
}

function normalizeRowValues(rows: unknown[][]): unknown[][] {
  return rows.map((row) =>
    row.map((cell) => {
      if (cell instanceof ArrayBuffer) {
        return Array.from(new Uint8Array(cell));
      }
      if (ArrayBuffer.isView(cell)) {
        return Array.from(
          new Uint8Array(cell.buffer, cell.byteOffset, cell.byteLength),
        );
      }
      return cell;
    }),
  );
}

class D1Queryable {
  readonly provider = "sqlite" as const;
  readonly adapterName = "@prisma/adapter-d1" as const;
  protected readonly d1: D1DatabaseLike;

  constructor(d1: D1DatabaseLike) {
    this.d1 = d1;
  }

  protected prepare(query: SqlQuery): D1PreparedStatementLike {
    const stmt = this.d1.prepare(query.sql);
    if (query.args.length === 0) return stmt;
    return stmt.bind(...query.args.map(cleanArg));
  }

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const stmt = this.prepare(query);
    const rawResult = await stmt.raw({ columnNames: true });
    if (!rawResult || rawResult.length === 0) {
      return {
        columnNames: [],
        columnTypes: [],
        rows: [],
      };
    }

    const [columnNames, ...rawRows] = rawResult as [string[], ...unknown[][]];
    const rows = normalizeRowValues(rawRows);
    const columnTypes = inferColumnTypes(columnNames, rawRows);

    return {
      columnNames,
      columnTypes,
      rows,
    };
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const stmt = this.prepare(query);
    const res = await stmt.run();
    return res.meta?.changes ?? 0;
  }
}

class D1DriverAdapter extends D1Queryable {
  async executeScript(script: string): Promise<void> {
    await this.d1.exec(script);
  }

  getConnectionInfo() {
    return {
      maxBindValues: 98, // D1 caps bound parameters at 100 per query
      supportsRelationJoins: false,
    };
  }

  async startTransaction() {
    return {
      provider: this.provider,
      adapterName: this.adapterName,
      options: { usePhantomQuery: true },
      queryRaw: (q: SqlQuery) => this.queryRaw(q),
      executeRaw: (q: SqlQuery) => this.executeRaw(q),
      commit: async () => {},
      rollback: async () => {},
    };
  }

  async dispose(): Promise<void> {}
}

export class PrismaD1Adapter implements SqlDriverAdapterFactory {
  readonly provider = "sqlite" as const;
  readonly adapterName = "@prisma/adapter-d1" as const;
  private readonly d1: D1DatabaseLike;

  constructor(d1: D1DatabaseLike) {
    this.d1 = d1;
  }

  async connect() {
    return new D1DriverAdapter(this.d1);
  }
}
