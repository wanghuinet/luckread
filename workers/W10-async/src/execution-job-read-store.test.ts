import { describe, expect, it, vi } from 'vitest'
import {
  createD1W10T16MembershipRenewalJobReadStore,
  W10ExecutionJobReadStoreError,
  type W10D1ReadExecutor,
  type W10ExecutionJobReadRow,
} from './execution-job-read-store.js'
import {
  createPostgresW10T16MembershipRenewalJobReadStore,
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

describe('W10 T16 membership-renewal execution job read store', () => {
  it('reads an operation only inside the admitted W07 T16 owner scope through D1', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = job('op_membership_1')
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values })
            return { first: async <T>() => row as T, all: async () => ({ results: [] }) },
          },
        }
      },
    }

    const result = await createD1W10T16MembershipRenewalJobReadStore(db)
      .getByOperationId('op_membership_1')

    expect(result).toEqual(row)
    expect(calls[0]?.values).toEqual(['op_membership_1'])
    expect(calls[0]?.sql).toContain("j.owner_worker = 'W07'")
    expect(calls[0]?.sql).toContain("j.owner_task_id = 'T16'")
    expect(calls[0]?.sql).not.toContain('actor_id')
    expect(calls[0]?.sql).not.toContain('subject_id')
  })

  it('scopes D1 lists to W07 T16, state and keyset cursor', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const rows = [job('op_z'), job('op_y')]
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values })
            return { first: async () => null, all: async () => ({ results: rows }) }
          },
        }
      },
    }

    const result = await createD1W10T16MembershipRenewalJobReadStore(db).list({
      states: ['RUNNING', 'SUCCEEDED'],
      cursor: { updatedAt: '2026-11-10T04:02:00.000123Z', operationId: 'op_m' },
      limit: 3,
    })

    expect(result).toEqual(rows)
    expect(calls[0]?.values).toEqual([
      'RUNNING',
      'SUCCEEDED',
      '2026-11-10T04:02:00.000123Z',
      '2026-11-10T04:02:00.000123Z',
      'op_m',
      3,
    ])
    expect(calls[0]?.sql).toContain("j.owner_worker = 'W07'")
    expect(calls[0]?.sql).toContain("j.owner_task_id = 'T16'")
    expect(calls[0]?.sql).toContain('j.state IN (?,?)')
    expect(calls[0]?.sql).toContain('j.updated_at < ? OR (j.updated_at = ? AND j.operation_id < ?)')
    expect(calls[0]?.sql).toContain('ORDER BY j.updated_at DESC,j.operation_id DESC')
    expect(calls[0]?.sql).toContain('LIMIT ?')
  })

  it('returns no D1 rows for an explicitly empty state filter without querying', async () => {
    const prepare = vi.fn(() => { throw new Error('empty state filter must not query D1') })
    const result = await createD1W10T16MembershipRenewalJobReadStore({ prepare } as unknown as W10D1ReadExecutor).list({
      states: [],
      limit: 10,
    })

    expect(result).toEqual([])
    expect(prepare).not.toHaveBeenCalled()
  })

  it('uses parameterized PostgreSQL state filters and preserves microsecond cursors', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const rows = [job('op_z'), job('op_y')]
    const db: W10PostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: rows as unknown as Row[] }
      },
    }

    const result = await createPostgresW10T16MembershipRenewalJobReadStore(db).list({
      states: ['RUNNING', 'SUCCEEDED'],
      cursor: { updatedAt: '2026-11-10T04:02:00.000123Z', operationId: 'op_m' },
      limit: 3,
    })

    expect(result).toEqual(rows)
    expect(calls[0]?.values).toEqual([
      ['RUNNING', 'SUCCEEDED'],
      '2026-11-10T04:02:00.000123Z',
      'op_m',
      3,
    ])
    expect(calls[0]?.sql).toContain("j.owner_worker = 'W07'")
    expect(calls[0]?.sql).toContain("j.owner_task_id = 'T16'")
    expect(calls[0]?.sql).toContain('j.state = ANY($1::text[])')
    expect(calls[0]?.sql).toContain('j.updated_at < $2::timestamptz')
    expect(calls[0]?.sql).toContain('j.updated_at = $2::timestamptz AND j.operation_id < $3')
    expect(calls[0]?.sql).toContain('HH24:MI:SS.US')
    expect(calls[0]?.sql).toContain('ORDER BY j.updated_at DESC,j.operation_id DESC')
    expect(calls[0]?.sql).toContain('LIMIT $4')
    expect(calls[0]?.sql).not.toContain('actor_id')
    expect(calls[0]?.sql).not.toContain('subject_id')
  })

  it('maps D1 and PostgreSQL failures to a sanitized service-unavailable error', async () => {
    const d1 = createD1W10T16MembershipRenewalJobReadStore({
      prepare() {
        return { bind() { return { first: async () => { throw new Error('private D1 detail') }, all: async () => { throw new Error('private D1 detail') } } }
      },
    })
    const pg = createPostgresW10T16MembershipRenewalJobReadStore({
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
    const store = createPostgresW10T16MembershipRenewalJobReadStore({
      query,
    } as unknown as W10PostgresQueryExecutor)

    await expect(store.list({ limit: 52 })).rejects.toThrow(
      'W10_EXECUTION_JOB_READ_LIMIT_INVALID',
    )
    expect(query).not.toHaveBeenCalled()
  })
})
