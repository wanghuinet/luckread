/// <reference types="@cloudflare/workers-types" />

export interface W06ModerationPostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>
  release(): void
}

export interface W06ModerationPostgresPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount: number | null }>
  connect(): Promise<W06ModerationPostgresClient>
}

type BoundStatement = Readonly<{ sql: string; values: unknown[] }>
const boundStatements = new WeakMap<object, BoundStatement>()

function normalizeRow<Row extends Record<string, unknown>>(row: Row): Row {
  const normalized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    normalized[key] = value instanceof Date && Number.isFinite(value.getTime())
      ? value.toISOString()
      : value
  }
  return normalized as Row
}

function normalizeRows<Row extends Record<string, unknown>>(rows: Row[]): Row[] {
  return rows.map(normalizeRow)
}

/** Replace D1 positional markers without rewriting question marks in strings or SQL comments. */
export function toPostgresModerationSql(sql: string): string {
  let result = ''
  let index = 0
  let parameter = 0
  let singleQuoted = false
  let doubleQuoted = false
  let lineComment = false
  let blockComment = false

  while (index < sql.length) {
    const char = sql[index]!
    const next = sql[index + 1]

    if (lineComment) {
      result += char
      index += 1
      if (char === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      result += char
      index += 1
      if (char === '*' && next === '/') {
        result += '/'
        index += 1
        blockComment = false
      }
      continue
    }
    if (singleQuoted) {
      result += char
      index += 1
      if (char === "'" && next === "'") {
        result += next
        index += 1
      } else if (char === "'") {
        singleQuoted = false
      }
      continue
    }
    if (doubleQuoted) {
      result += char
      index += 1
      if (char === '"' && next === '"') {
        result += next
        index += 1
      } else if (char === '"') {
        doubleQuoted = false
      }
      continue
    }

    if (char === '-' && next === '-') {
      result += '--'
      index += 2
      lineComment = true
    } else if (char === '/' && next === '*') {
      result += '/*'
      index += 2
      blockComment = true
    } else if (char === "'") {
      result += char
      index += 1
      singleQuoted = true
    } else if (char === '"') {
      result += char
      index += 1
      doubleQuoted = true
    } else if (char === '?') {
      parameter += 1
      result += '$' + parameter
      index += 1
    } else {
      result += char
      index += 1
    }
  }

  return result
}

function isModerationChangeGuard(sql: string): boolean {
  const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
  return /^insert or replace into moderation_txn_guard\s*\(\s*id\s*,\s*successful\s*\)\s*values\s*\(\s*1\s*,\s*changes\(\)\s*\)$/.test(normalized)
}

function normalizeDatabaseError(error: unknown): Error {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
    // Preserve the existing W06 idempotent unique-conflict/replay branch.
    return new Error('UNIQUE constraint failed')
  }
  return error instanceof Error ? error : new Error('W06 PostgreSQL moderation persistence failed')
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
  } as unknown as D1Result<T>
}

/**
 * D1-compatible adapter for W06 moderation persistence.
 * Every D1 batch maps to one PostgreSQL transaction. The moderation transaction
 * guard receives the preceding UPDATE row count, preserving D1 changes() CAS
 * semantics and rolling the full decision transaction back on a stale version.
 */
export function createPostgresModerationD1Database(pool: W06ModerationPostgresPool): D1Database {
  async function execute<Row extends Record<string, unknown>>(
    statement: BoundStatement,
  ): Promise<{ rows: Row[]; rowCount: number | null }> {
    try {
      return await pool.query<Row>(toPostgresModerationSql(statement.sql), statement.values)
    } catch (error) {
      throw normalizeDatabaseError(error)
    }
  }

  const database = {
    prepare(sql: string): D1PreparedStatement {
      const state: { sql: string; values: unknown[] } = { sql, values: [] }
      let statement: D1PreparedStatement
      const prepared = {
        bind(...values: unknown[]) {
          state.values = values
          return statement
        },
        async first<T = unknown>(columnName?: string): Promise<T | null> {
          const result = await execute<Record<string, unknown>>(state)
          const row = result.rows[0]
          if (!row) return null
          const normalized = normalizeRow(row)
          return (columnName ? normalized[columnName] : normalized) as T
        },
        async all<T = unknown>(): Promise<D1Result<T>> {
          const result = await execute<Record<string, unknown>>(state)
          const rows = normalizeRows(result.rows) as T[]
          return toD1Result(rows, result.rowCount ?? rows.length)
        },
        async run<T = unknown>(): Promise<D1Result<T>> {
          const result = await execute<Record<string, unknown>>(state)
          const rows = normalizeRows(result.rows) as T[]
          return toD1Result(rows, result.rowCount ?? rows.length)
        },
        async raw<T = unknown>(options?: { columnNames?: boolean }): Promise<T[]> {
          const result = await execute<Record<string, unknown>>(state)
          const rows = normalizeRows(result.rows)
          if (options?.columnNames) {
            const first = rows[0]
            return (first ? [Object.keys(first), ...rows.map((row) => Object.values(row))] : []) as T[]
          }
          return rows.map((row) => Object.values(row)) as T[]
        },
      }
      statement = prepared as unknown as D1PreparedStatement
      boundStatements.set(statement as object, state)
      return statement
    },

    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      if (statements.length === 0) return []
      const client = await pool.connect()
      let transactionOpen = false
      let previousChanges = 0
      try {
        await client.query('BEGIN')
        transactionOpen = true
        const results: D1Result<T>[] = []

        for (const statement of statements) {
          const bound = boundStatements.get(statement as object)
          if (!bound) {
            throw new Error('W06 PostgreSQL batch received a foreign prepared statement')
          }

          const guard = isModerationChangeGuard(bound.sql)
          const sql = guard
            ? 'INSERT INTO moderation_txn_guard (id, successful) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET successful = EXCLUDED.successful'
            : toPostgresModerationSql(bound.sql)
          const values = guard ? [previousChanges] : bound.values

          let result: { rows: Record<string, unknown>[]; rowCount: number | null }
          try {
            result = await client.query<Record<string, unknown>>(sql, values)
          } catch (error) {
            throw normalizeDatabaseError(error)
          }

          const changes = result.rowCount ?? result.rows.length
          results.push(toD1Result(normalizeRows(result.rows) as T[], changes))
          previousChanges = changes
        }

        await client.query('COMMIT')
        transactionOpen = false
        return results
      } catch (error) {
        if (transactionOpen) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original persistence error.
          }
        }
        throw normalizeDatabaseError(error)
      } finally {
        client.release()
      }
    },
  }

  return database as unknown as D1Database
}
