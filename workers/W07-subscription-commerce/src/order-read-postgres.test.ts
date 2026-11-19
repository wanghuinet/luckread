import { describe, expect, it, vi } from 'vitest'
import type {
  W07WebhookPostgresClient,
  W07WebhookPostgresPool,
} from './payment-webhook-database-postgres.js'
import { OrderPersistenceError } from './order-persistence.js'
import { getCommerceOrderPostgres } from './order-read-postgres.js'

const customerId = 'customer_upgrade_01'
const orderId = 'ord_upgrade_01'
const timestamp = '2026-11-19T08:00:00.000Z'

const orderRow = {
  order_id: orderId,
  status: 'CREATED',
  version: '1',
  currency: 'USD',
  subtotal_minor: '1250',
  discount_minor: '0',
  tax_minor: '0',
  total_minor: '1250',
  created_at: timestamp,
  updated_at: timestamp,
}

const lineRows = [{
  item_ref: 'plan_' + 'a'.repeat(64),
  quantity: '1',
  unit_amount_minor: '1250',
  line_subtotal_minor: '1250',
  line_discount_minor: '0',
  line_tax_minor: '0',
  line_total_minor: '1250',
  item_snapshot_json: JSON.stringify({ planId: 'plan_' + 'a'.repeat(64), planVersion: 2 }),
}]

function fixture(options: {
  orderRows?: Array<Record<string, unknown>>
  lineRows?: Array<Record<string, unknown>>
  failOn?: 'order' | 'lines'
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  let released = 0
  const client: W07WebhookPostgresClient = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.failOn === 'order' && sql.includes('FROM orders')) throw new Error('raw database detail')
      if (options.failOn === 'lines' && sql.includes('FROM order_lines')) throw new Error('raw database detail')
      const rows = sql.includes('FROM orders')
        ? options.orderRows ?? [orderRow]
        : sql.includes('FROM order_lines')
          ? options.lineRows ?? lineRows
          : []
      return { rows: rows as Row[], rowCount: rows.length }
    },
    release() { released += 1 },
  }
  const pool: W07WebhookPostgresPool = {
    async query<Row extends Record<string, unknown>>() {
      return { rows: [] as Row[], rowCount: 0 }
    },
    async connect() { return client },
  }
  return { pool, calls, get released() { return released } }
}

describe('W07 owner-scoped Neon Order reads', () => {
  it('reads an Order and its immutable OrderLines in one repeatable-read transaction', async () => {
    const f = fixture()

    const result = await getCommerceOrderPostgres(f.pool, customerId, orderId)

    expect(result).toEqual({
      orderId,
      status: 'CREATED',
      version: 1,
      currency: 'USD',
      subtotalMinor: 1250,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1250,
      items: [{
        itemRef: 'plan_' + 'a'.repeat(64),
        quantity: 1,
        unitAmountMinor: 1250,
        lineSubtotalMinor: 1250,
        lineDiscountMinor: 0,
        lineTaxMinor: 0,
        lineTotalMinor: 1250,
      }],
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect(f.calls.map((call) => call.sql.split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'BEGIN TRANSACTION ISOLATION',
      expect.stringContaining('SELECT order_id, status,'),
      expect.stringContaining('SELECT item_ref, quantity::text'),
      'COMMIT',
    ])
    expect(f.calls[1]?.values).toEqual([orderId, customerId])
    expect(f.calls[1]?.sql).toContain('customer_id = $2')
    expect(f.calls[2]?.values).toEqual([orderId])
    expect(f.calls[2]?.sql).toContain('ORDER BY order_line_id ASC')
    expect(f.released).toBe(1)
  })

  it('returns a scoped not-found error and rolls back when the owner does not own the Order', async () => {
    const f = fixture({ orderRows: [] })

    await expect(getCommerceOrderPostgres(f.pool, customerId, orderId))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(f.released).toBe(1)
  })

  it('fails closed on database errors and releases the client', async () => {
    const f = fixture({ failOn: 'lines' })

    const result = getCommerceOrderPostgres(f.pool, customerId, orderId)
    await expect(result).rejects.toBeInstanceOf(OrderPersistenceError)
    await expect(result).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(f.released).toBe(1)
  })

  it('rejects inconsistent pricing snapshot modes', async () => {
    const f = fixture({
      lineRows: [
        ...lineRows,
        {
          ...lineRows[0],
          item_ref: 'plan_' + 'b'.repeat(64),
          item_snapshot_json: JSON.stringify({ luckreadPricing: { mode: 'demo' } }),
        },
      ],
    })

    await expect(getCommerceOrderPostgres(f.pool, customerId, orderId))
      .rejects.toMatchObject({ code: 'INTEGRITY_VIOLATION', status: 500 })
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK')
  })

  it('rejects invalid identifiers before opening a connection', async () => {
    const f = fixture()

    await expect(getCommerceOrderPostgres(f.pool, ' customer', orderId))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(f.calls).toHaveLength(0)
    expect(f.released).toBe(0)
  })
})
