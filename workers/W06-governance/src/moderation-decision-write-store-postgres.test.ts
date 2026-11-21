import { describe, expect, it } from 'vitest'

import type { W06ModerationPostgresPool } from './moderation-postgres-pool'
import {
  createPostgresModerationDecisionWriteStore,
  ModerationDecisionWriteStoreError,
  type ModerationReadyOutboxRow,
} from './moderation-decision-write-store-postgres'

type Call = { sql: string; values: unknown[] }

function createPool(options: {
  rows?: ModerationReadyOutboxRow[]
  fail?: boolean
} = {}): { pool: W06ModerationPostgresPool; calls: Call[] } {
  const calls: Call[] = []
  const pool: W06ModerationPostgresPool = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('private PostgreSQL connection detail')
      return {
        rows: (options.rows ?? []) as unknown as Row[],
        rowCount: options.rows?.length ?? 0,
      }
    },
    async connect() {
      throw new Error('transaction connection is not used by the Outbox scan tests')
    },
  }
  return { pool, calls }
}

const readyRow: ModerationReadyOutboxRow = {
  outbox_id: 'outbox_1',
  decision_id: 'decision_1',
  case_id: 'case_1',
  target_type: 'content',
  target_id: 'content_1',
  target_version: 3,
  outcome: 'APPROVED',
  policy_version: 'moderation-v1',
  idempotency_key: 'moderation-idem-1',
  status: 'RETRY',
  attempts: 2,
  reviewer_id: 'reviewer_1',
  reviewer_layer: 'L6',
  request_id: 'req_1',
}

describe('W06 native PostgreSQL moderation Outbox store', () => {
  it('selects only due pending/retry rows in stable due-time order with a bounded SQL limit', async () => {
    const { pool, calls } = createPool({ rows: [readyRow] })
    const store = createPostgresModerationDecisionWriteStore(pool)

    const rows = await store.listReadyOutbox('2026-11-19T12:00:00.000Z', 10)

    expect(rows).toEqual([readyRow])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['2026-11-19T12:00:00.000Z', 10])
    expect(calls[0]?.sql).toContain("o.status IN ('PENDING', 'RETRY')")
    expect(calls[0]?.sql).toContain('o.next_attempt_at <= $1::timestamptz')
    expect(calls[0]?.sql).toContain('JOIN moderation_decisions d ON d.decision_id = o.decision_id')
    expect(calls[0]?.sql).toContain('ORDER BY o.next_attempt_at ASC, o.created_at ASC')
    expect(calls[0]?.sql).toContain('LIMIT $2')
    expect(calls[0]?.sql).not.toContain('moderation_reports')
  })

  it('schedules missing decision actors for a one-minute retry and increments attempts', async () => {
    const { pool, calls } = createPool()
    const store = createPostgresModerationDecisionWriteStore(pool)

    await store.markOutboxMissingActor('outbox_1', '2026-11-19T12:01:00.000Z')

    expect(calls).toEqual([{
      sql: expect.stringContaining("last_error = 'MISSING_DECISION_ACTOR'"),
      values: ['2026-11-19T12:01:00.000Z', 'outbox_1'],
    }])
    expect(calls[0]?.sql).toContain("status IN ('PENDING', 'RETRY')")
    expect(calls[0]?.sql).toContain('attempts = attempts + 1')
  })

  it('uses guarded native PostgreSQL updates for delivery success and retry', async () => {
    const { pool, calls } = createPool()
    const store = createPostgresModerationDecisionWriteStore(pool)

    await store.markOutboxDelivered('outbox_1', '2026-11-19T12:00:01.000Z')
    await store.markOutboxRetry('outbox_1', 3, '2026-11-19T12:00:10.000Z', 'W03_503')

    expect(calls).toHaveLength(2)
    expect(calls[0]?.sql).toContain("status = 'DELIVERED'")
    expect(calls[0]?.values).toEqual(['2026-11-19T12:00:01.000Z', 'outbox_1'])
    expect(calls[1]?.sql).toContain("status = 'RETRY'")
    expect(calls[1]?.values).toEqual([3, '2026-11-19T12:00:10.000Z', 'W03_503', 'outbox_1'])
  })

  it('maps PostgreSQL scan failures to a sanitized service error', async () => {
    const { pool } = createPool({ fail: true })
    const store = createPostgresModerationDecisionWriteStore(pool)

    await expect(
      store.listReadyOutbox('2026-11-19T12:00:00.000Z', 10),
    ).rejects.toBeInstanceOf(ModerationDecisionWriteStoreError)
    await expect(
      store.listReadyOutbox('2026-11-19T12:00:00.000Z', 10),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'SERVICE_UNAVAILABLE',
    })
  })
})
