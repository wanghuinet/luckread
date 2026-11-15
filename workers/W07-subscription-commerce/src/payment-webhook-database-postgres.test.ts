import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresWebhookD1Database,
  type W07WebhookPostgresClient,
  type W07WebhookPostgresPool,
} from './payment-webhook-database-postgres.js'
import { buildCompletePaymentMethodRevocationOnMandateWebhook } from './payment-method-persistence.js'

function fakePool(options: {
  queryRows?: Record<string, unknown>[]
  failAtBatchQuery?: number
} = {}) {
  const directCalls: Array<{ sql: string; values?: unknown[] }> = []
  const clientCalls: string[] = []
  let batchQuery = 0
  const client: W07WebhookPostgresClient = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
      clientCalls.push(sql)
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return { rows: [] as Row[], rowCount: 0 }
      }
      batchQuery += 1
      if (options.failAtBatchQuery === batchQuery) throw new Error('simulated PostgreSQL failure')
      return { rows: [] as Row[], rowCount: 1 }
    },
    release: vi.fn(),
  }
  const pool: W07WebhookPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
      directCalls.push({ sql, values })
      return { rows: (options.queryRows ?? []) as Row[], rowCount: options.queryRows?.length ?? 0 }
    },
    async connect() {
      return client
    },
  }
  return { pool, directCalls, clientCalls, client }
}

describe('W07 PostgreSQL webhook D1 bridge', () => {
  it('translates bound parameters and normalizes PostgreSQL BIGINT/timestamps for existing webhook logic', async () => {
    const createdAt = new Date('2026-11-15T12:00:00.123Z')
    const { pool, directCalls } = fakePool({
      queryRows: [{
        payment_id: 'pay_12345678901234567890123456',
        amount_minor: '1499',
        refunded_minor: '199',
        unit_amount_minor: '1200',
        line_subtotal_minor: '1200',
        line_discount_minor: '0',
        line_tax_minor: '0',
        line_total_minor: '1200',
        version: '3',
        created_at: createdAt,
      }],
    })
    const database = createPostgresWebhookD1Database(pool)
    const row = await database.prepare(
      "SELECT payment_id, amount_minor, refunded_minor, unit_amount_minor, line_subtotal_minor, line_discount_minor, line_tax_minor, line_total_minor, version, created_at FROM payments WHERE payment_id = ? AND note = '?'",
    ).bind('pay_12345678901234567890123456').first<{
      amount_minor: number
      refunded_minor: number
      unit_amount_minor: number
      line_subtotal_minor: number
      line_discount_minor: number
      line_tax_minor: number
      line_total_minor: number
      version: number
      created_at: string
    }>()

    expect(directCalls[0]?.sql).toContain('payment_id = $1')
    expect(directCalls[0]?.sql).toContain("note = '?'")
    expect(row).toMatchObject({
      amount_minor: 1499,
      refunded_minor: 199,
      unit_amount_minor: 1200,
      line_subtotal_minor: 1200,
      line_discount_minor: 0,
      line_tax_minor: 0,
      line_total_minor: 1200,
      version: 3,
      created_at: '2026-11-15T12:00:00.123Z',
    })
  })

  it('uses PostgreSQL-native monotonic timestamp arithmetic for Mandate revocation completion', () => {
    const statements: string[] = []
    const fakeDatabase = {
      prepare(sql: string) {
        statements.push(sql)
        const statement = {
          bind() { return statement },
        }
        return statement as unknown as D1PreparedStatement
      },
    } as unknown as D1Database

    buildCompletePaymentMethodRevocationOnMandateWebhook(
      fakeDatabase, 'merchant_01', 'customer_01', 'pm_01', '2026-11-15T12:00:00.000Z', 'postgres',
    )

    expect(statements[0]).toContain("GREATEST(updated_at + INTERVAL '1 millisecond', ?::timestamptz)")
    expect(statements[0]).not.toContain('strftime')
    expect(statements[0]).not.toContain('julianday')
  })

  it('executes every D1 batch statement in one PostgreSQL transaction and returns change counts', async () => {
    const { pool, clientCalls, client } = fakePool()
    const database = createPostgresWebhookD1Database(pool)
    const results = await database.batch([
      database.prepare('INSERT INTO payment_provider_events(event_id) VALUES (?)').bind('evt_1'),
      database.prepare('UPDATE payments SET status = ? WHERE payment_id = ?').bind('succeeded', 'pay_1'),
    ])

    expect(clientCalls).toEqual([
      'BEGIN',
      'INSERT INTO payment_provider_events(event_id) VALUES ($1)',
      'UPDATE payments SET status = $1 WHERE payment_id = $2',
      'COMMIT',
    ])
    expect(results.map((result) => result.meta.changes)).toEqual([1, 1])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back the entire batch when a statement fails', async () => {
    const { pool, clientCalls, client } = fakePool({ failAtBatchQuery: 2 })
    const database = createPostgresWebhookD1Database(pool)

    await expect(database.batch([
      database.prepare('UPDATE payments SET status = ? WHERE payment_id = ?').bind('succeeded', 'pay_1'),
      database.prepare('UPDATE payment_provider_events SET state = ? WHERE event_id = ?').bind('APPLIED', 'evt_1'),
    ])).rejects.toThrow('simulated PostgreSQL failure')

    expect(clientCalls).toEqual([
      'BEGIN',
      'UPDATE payments SET status = $1 WHERE payment_id = $2',
      'UPDATE payment_provider_events SET state = $1 WHERE event_id = $2',
      'ROLLBACK',
    ])
    expect(client.release).toHaveBeenCalledOnce()
  })
})
