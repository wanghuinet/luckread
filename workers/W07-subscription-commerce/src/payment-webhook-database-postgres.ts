/// <reference types="@cloudflare/workers-types" />

type PostgresQueryResult<Row extends Record<string, unknown>> = Readonly<{
  rows: Row[];
  rowCount: number | null;
}>;

export interface W07WebhookPostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  release(): void;
}

export interface W07WebhookPostgresPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  connect(): Promise<W07WebhookPostgresClient>;
}

type BoundStatement = Readonly<{ sql: string; values: unknown[] }>;

const boundStatements = new WeakMap<object, BoundStatement>();

const BIGINT_COLUMNS = new Set([
  'amount_minor',
  'subtotal_minor',
  'discount_minor',
  'tax_minor',
  'total_minor',
  'version',
  'occurrence_count',
  'refunded_minor',
  'unit_amount_minor',
  'line_subtotal_minor',
  'line_discount_minor',
  'line_tax_minor',
  'line_total_minor',
  'attempt_count',
  'cycle_number',
  'quantity',
  'lease_generation',
]);

function normalizeRow<Row extends Record<string, unknown>>(row: Row): Row {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      normalized[key] = value.toISOString();
      continue;
    }
    if (BIGINT_COLUMNS.has(key) && typeof value === 'string') {
      const number = Number(value);
      if (!Number.isSafeInteger(number)) {
        throw new Error('W07 PostgreSQL integer exceeds the safe runtime range');
      }
      normalized[key] = number;
      continue;
    }
    normalized[key] = value;
  }
  return normalized as Row;
}

/** Replace D1 positional markers without rewriting question marks inside SQL strings or comments. */
export function toPostgresWebhookSql(sql: string): string {
  let result = '';
  let position = 0;
  let parameter = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockComment = false;

  while (position < sql.length) {
    const char = sql[position]!;
    const next = sql[position + 1];

    if (lineComment) {
      result += char;
      position += 1;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      result += char;
      position += 1;
      if (char === '*' && next === '/') {
        result += '/';
        position += 1;
        blockComment = false;
      }
      continue;
    }
    if (singleQuoted) {
      result += char;
      position += 1;
      if (char === "'" && next === "'") {
        result += next;
        position += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      result += char;
      position += 1;
      if (char === '"' && next === '"') {
        result += next;
        position += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }

    if (char === '-' && next === '-') {
      result += '--';
      position += 2;
      lineComment = true;
    } else if (char === '/' && next === '*') {
      result += '/*';
      position += 2;
      blockComment = true;
    } else if (char === "'") {
      result += char;
      position += 1;
      singleQuoted = true;
    } else if (char === '"') {
      result += char;
      position += 1;
      doubleQuoted = true;
    } else if (char === '?') {
      parameter += 1;
      result += '$' + parameter;
      position += 1;
    } else {
      result += char;
      position += 1;
    }
  }
  return result;
}

function toD1Result<T>(rows: T[], changes: number): D1Result<T> {
  return {
    success: true,
    results: rows,
    meta: {
      changes,
      duration: 0,
      last_row_id: 0,
      rows_read: 0,
      rows_written: changes,
      size_after: 0,
      changed_db: changes > 0,
    },
  } as unknown as D1Result<T>;
}

/**
 * D1-compatible query surface for the existing W07 webhook business logic.
 * Every D1 batch maps to exactly one PostgreSQL transaction; statement reads
 * and standalone writes retain their normal autocommit behavior.
 */
export function createPostgresWebhookD1Database(pool: W07WebhookPostgresPool): D1Database {
  function execute<Row extends Record<string, unknown>>(
    statement: BoundStatement,
  ): Promise<PostgresQueryResult<Row>> {
    return pool.query<Row>(toPostgresWebhookSql(statement.sql), statement.values);
  }

  const database = {
    prepare(sql: string): D1PreparedStatement {
      const state: { sql: string; values: unknown[] } = { sql, values: [] };
      let statement: D1PreparedStatement;
      const prepared = {
        bind(...values: unknown[]) {
          state.values = values;
          return statement;
        },
        async first<T = unknown>(columnName?: string): Promise<T | null> {
          const result = await execute<Record<string, unknown>>(state);
          const row = result.rows[0];
          if (!row) return null;
          const normalized = normalizeRow(row);
          return (columnName ? normalized[columnName] : normalized) as T;
        },
        async all<T = unknown>(): Promise<D1Result<T>> {
          const result = await execute<Record<string, unknown>>(state);
          const rows = result.rows.map((row) => normalizeRow(row)) as T[];
          return toD1Result(rows, result.rowCount ?? rows.length);
        },
        async run<T = unknown>(): Promise<D1Result<T>> {
          const result = await execute<Record<string, unknown>>(state);
          const rows = result.rows.map((row) => normalizeRow(row)) as T[];
          return toD1Result(rows, result.rowCount ?? rows.length);
        },
        async raw<T = unknown>(options?: { columnNames?: boolean }): Promise<T[]> {
          const result = await execute<Record<string, unknown>>(state);
          const rows = result.rows.map((row) => normalizeRow(row));
          if (options?.columnNames) {
            const first = rows[0];
            return (first ? [Object.keys(first), ...rows.map((row) => Object.values(row))] : []) as T[];
          }
          return rows.map((row) => Object.values(row)) as T[];
        },
      };
      statement = prepared as unknown as D1PreparedStatement;
      boundStatements.set(statement as object, state);
      return statement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query('BEGIN');
        transactionOpen = true;
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          const bound = boundStatements.get(statement as object);
          if (!bound) throw new Error('W07 PostgreSQL batch received a foreign prepared statement');
          const result = await client.query<Record<string, unknown>>(
            toPostgresWebhookSql(bound.sql),
            bound.values,
          );
          const rows = result.rows.map((row) => normalizeRow(row)) as T[];
          results.push(toD1Result(rows, result.rowCount ?? rows.length));
        }
        await client.query('COMMIT');
        transactionOpen = false;
        return results;
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // Preserve the original database error.
          }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };

  return database as unknown as D1Database;
}
