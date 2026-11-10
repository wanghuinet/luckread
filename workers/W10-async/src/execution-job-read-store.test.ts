import { describe, expect, it, vi } from 'vitest'
import {
  createD1W10ExecutionJobReadStore,
  W10ExecutionJobReadStoreError,
  type W10ExecutionJobReadRow,
} from './execution-job-read-store.js'
import {
  createPostgresW10ExecutionJobReadStore,
  type W10PostgresQueryExecutor,
} from './execution-job-read-store-postgres.js'

const job = (operationId: string): W10ExecutionJobReadRow => ({
  job_id: 'job_' + operationId,
  operation_id: operationId,
  operation_type: 'membership-renewal-scheduled-batch',
  owner_worker: 'W07',
  owner_task_id: 'T16',
  resource_type: 'MembershipRenewalWorkflow',
  resource_id: 'workflow_1',
  scope: 'w07:t16:membership-renewal',
  state: 'RUNNING',
  progress_current: null,
  progress_total: null,
  created_at: '2026-11-10T04:02:00.000123Z',
  started_at: '2026-11-10T04:02:00.000123Z',
  updated_at: '2026-11-10T04:02:00.000123Z',
  completed_at: null,
  expires_at: '2026-12-10T04:02:00.000123Z',
  error_code: null,
  result_ref: null,
})

describe('W10 execution job read store', () => {
  it('reads one operation by its stable operation ID through D1', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = job('op_membership_1')
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values })
            return { first: async <T>() => row as T },
          },
        }
      },
    }

    const result = await createD1W10ExecutionJobReadStore(db)
      .getByOperationId('op_membership_1')

    expect(result).toEqual(row)
    expect(calls[0]?.values).toEqual(['op_membership_1'])
    expect(calls[0]?.sql).toContain('FROM jobs j')
    expect(calls[0]?.sql).toContain('WHERE j.operation_id = ?')
    expect(calls[0]?.sql).not.toContain('actor_id')
    expect(calls[0]?.sql).not.toContain('subject_id')
  })

  it('scopes D1 lists to owner, task, state and keyset cursor', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const rows = [job('op_z'), job('op_y')]
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values })
            return { all: async () => ({ results: rows }) },
          },
        }
      },
    }

    const result = await createD1W10ExecutionJobReadStore(db).list({
      ownerWorker: 'W07',
      ownerTaskId: 'T16',
      states: ['RUNNING', 'SUCCEEDED'],
      cursor: { updatedAt: '2026-11-10T04:02:00.000123Z', operationId: 'op_m' },
      limit: 3,
    })

    expect(result).toEqual(rows)
    expect(calls[0]?.values).toEqual([
      'W07',
      'T16',
      'RUNNING',
      'SUCCEEDED',
      '2026-11-10T04:02:00.000123Z',
      '2026-11-10T04:02:00.000123Z',
      'op_m',
      3,
    ])
    expect(calls[0]?.sql).toContain('j.owner_worker = ?')
    expect(calls[0]?.sql).toContain('j.owner_task_id = ?')
    expect(calls[0]?.sql).toContain('j.state IN (?,?)')
    expect(calls[0]?.sql).toContain('j.updated_at < ? OR (j.updated_at = ? AND j.operation_id < ?)')
    expect(calls[0]?.sql).toContain('ORDER BY j.updated_at DESC,j.operation_id DESC')
    expect(calls[0]?.sql).toContain('LIMIT ?')
  })

  it('returns no D1 rows for an explicitly empty state filter without querying', async () => {
    const prepare = vi.fn()
    const result = await createD1W10ExecutionJobReadStore({ prepare }).list({
      ownerWorker: 'W07',
      states: [],
      limit: 10,
    })

    expect(result).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
  })

  it('uses parameterized PostgreSQL task/state filters and preserves microsecond cursors', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const rows = [job('op_z'), job('op_y')]
    const db: W10PostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: rows as unknown as Row[] }
      },
    }

    const result = await createPostgresW10ExecutionJobReadStore(db).list({
      ownerWorker: 'W07',
      ownerTaskId: 'T16',
      states: ['RUNNING', 'SUCCEEDED'],
      cursor: { updatedAt: '2026-11-10T04:02:00.000123Z', operationId: 'op_m' },
      limit: 3,
    })

    expect(result).toEqual(rows)
    expect(calls[0]?.values).toEqual([
      'W07',
      'T16',
      ['RUNNING', 'SUCCEEDED'],
      '2026-11-10T04:02:00.000123Z',
      'op_m',
      3,
    ])
    expect(calls[0]?.sql).toContain('j.state = ANY($3::text[])')
    expect(calls[0]?.sql).toContain('j.updated_at < $4::timestamptz')
    expect(calls[0]?.sql).toContain('j.updated_at = $4::timestamptz AND j.operation_id < $5')
    expect(calls[0]?.sql).toContain('HH24:MI:SS.US')
    expect(calls[0]?.sql).toContain('ORDER BY j.updated_at DESC,j.operation_id DESC')
    expect(calls[0]?.sql).toContain('LIMIT $6')
    expect(calls[0]?.sql).not.toContain('actor_id')
    expect(calls[0]?.sql).not.toContain('subject_id')
  })

  it('supports explicit null task scope in PostgreSQL without widening to every task', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: W10PostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [] as Row[] }
      },
    }

    await createPostgresW10ExecutionJobReadStore(db).list({
      ownerWorker: 'W10',
      ownerTaskId: null,
      limit: 5,
    })

    expect(calls[0]?.values).toEqual(['W10', 5])
    expect(calls[0]?.sql).toContain('j.owner_task_id IS NULL')
    expect(calls[0]?.sql).not.toContain('j.owner_task_id =')
  })

  it('maps D1 and PostgreSQL failures to a sanitized service-unavailable error', async () => {
    const d1 = createD1W10ExecutionJobReadStore({
      prepare() {
        return { bind() { return { first: async () => { throw new Error('private D1 detail') }, all: async () => { throw new Error('private D1 detail') } } }
      },
    })
    const pg = createPostgresW10ExecutionJobReadStore({
      async query() {
        throw new Error('private PostgreSQL detail')
      },
    })

    await expect(d1.getByOperationId('op_1')).rejects.toBeInstanceOf(W10ExecutionJobReadStoreError)
    await expect(pg.getByOperationId('op_1')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'W10_EXECUTION_JOB_READ_UNAVAILABLE',
    })
  })

  it('rejects an invalid result limit before issuing SQL', async () => {
    const query = vi.fn()
    const store = createPostgresW10ExecutionJobReadStore({
      query,
    } as unknown as W10PostgresQueryExecutor)

    await expect(store.list({ ownerWorker: 'W07', limit: 52 })).rejects.toThrow(
      'W10_EXECUTION_JOB_READ_LIMIT_INVALID',
    )
    expect(query).not.toHaveBeenCalled()
  })
})
