import {
  W10ExecutionJobReadStoreError,
  type W10ExecutionJobReadInput,
  type W10ExecutionJobReadRow,
  type W10ExecutionJobReadStore,
} from './execution-job-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no database driver is bundled into W10. */
export interface W10PostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

const JOB_COLUMNS = [
  'j.job_id,j.operation_id,j.operation_type,j.owner_worker,j.owner_task_id,',
  'j.resource_type,j.resource_id,j.scope,j.state,j.progress_current,j.progress_total,',
  'to_char(j.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at,',
  'to_char(j.started_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS started_at,',
  'to_char(j.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at,',
  'to_char(j.completed_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS completed_at,',
  'to_char(j.expires_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS expires_at,',
  'j.error_code,j.result_ref',
].join('\n')

function assertValidRead(input: W10ExecutionJobReadInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 51) {
    throw new TypeError('W10_EXECUTION_JOB_READ_LIMIT_INVALID')
  }
  if (input.cursor && (!input.cursor.updatedAt || !input.cursor.operationId)) {
    throw new TypeError('W10_EXECUTION_JOB_READ_CURSOR_INVALID')
  }
}

/**
 * PostgreSQL adapter for the already-admitted W10 jobs table.
 * Timestamp output remains six-digit UTC text so keyset cursors retain microseconds.
 */
export function createPostgresW10T16MembershipRenewalJobReadStore(
  db: W10PostgresQueryExecutor,
): W10ExecutionJobReadStore {
  return {
    async getByOperationId(operationId) {
      try {
        const result = await db.query<W10ExecutionJobReadRow>(
          `SELECT ${JOB_COLUMNS}
             FROM jobs j
            WHERE j.operation_id = $1
              AND j.owner_worker = 'W07'
              AND j.owner_task_id = 'T16'`,
          [operationId],
        )
        return result.rows[0] ?? null
      } catch {
        throw new W10ExecutionJobReadStoreError()
      }
    },

    async list(input: W10ExecutionJobReadInput) {
      assertValidRead(input)
      if (input.states?.length === 0) return []

      const values: unknown[] = []
      const predicates = ["j.owner_worker = 'W07'", "j.owner_task_id = 'T16'"]

      if (input.states) {
        const parameter = values.length + 1
        predicates.push('j.state = ANY($' + parameter + '::text[])')
        values.push([...input.states])
      }

      if (input.cursor) {
        const timestampParameter = values.length + 1
        const operationParameter = values.length + 2
        predicates.push(
          '(j.updated_at < $' + timestampParameter + '::timestamptz' +
          ' OR (j.updated_at = $' + timestampParameter + '::timestamptz' +
          ' AND j.operation_id < $' + operationParameter + '))',
        )
        values.push(input.cursor.updatedAt, input.cursor.operationId)
      }

      const limitParameter = values.length + 1
      values.push(input.limit)

      try {
        const result = await db.query<W10ExecutionJobReadRow>(
          `SELECT ${JOB_COLUMNS}
             FROM jobs j
            WHERE ${predicates.join(' AND ')}
            ORDER BY j.updated_at DESC,j.operation_id DESC
            LIMIT $${limitParameter}`,
          values,
        )
        return result.rows
      } catch {
        // Do not expose PostgreSQL driver errors, SQL or connection details.
        throw new W10ExecutionJobReadStoreError()
      }
    },
  }
}
