import { describe, expect, it } from 'vitest'

import {
  OrderPersistenceError,
  type OrderCreateTransactionInput,
} from './order-persistence.js'
import {
  createPostgresOrderCreateStore,
  type OrderPersistencePostgresClient,
  type OrderPersistencePostgresPool,
} from './order-create-store-postgres.js'

const INPUT: OrderCreateTransactionInput = {
  customerId: 'customer_01',
  idempotencyId: 'idem_01',
  operationKey: 'POST /v1/commerce/orders',
  idempotencyKey: 'checkout-key-01',
  requestHash: 'a'.repeat(64),
  createdAt: '2026-11-11T12:00:00.000Z',
  expiresAt: '2026-11-12T12:00:00.000Z',
  responseJson: JSON.stringify({
    orderId: 'ord_01',
    status: 'CREATED',
    version: 1,
    currency: 'USD',
    subtotalMinor: 1200,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 1200,
    items: [{
      itemRef: 'plan_abc',
      quantity: 1,
      unitAmountMinor: 1200,
      lineSubtotalMinor: 1200,
      lineDiscountMinor: 0,
      lineTaxMinor: 0,
      lineTotalMinor: 1200,
    }],
    createdAt: '2026-11-11T12:00:00.000Z',
    updatedAt: '2026-11-11T12:00:00.000Z',
  }),
  order: {
    orderId: 'ord_01',
    currency: 'USD',
    subtotalMinor: 1200,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 1200,
  },
  lines: [{
    orderLineId: 'orl_01',
    item: {
      itemType: 'MEMBERSHIP_PLAN',
      itemRef: 'plan_abc',
      itemVersion: '1',
      quantity: 1,
      unitAmountMinor: 1200,
      currency: 'USD',
      lineDiscountMinor: 0,
      lineTaxMinor: 0,
      itemSnapshotJson: JSON.stringify({ planId: 'plan_abc', planVersion: 1 }),
    },
    lineSubtotalMinor: 1200,
    lineTotalMinor: 1200,
  }],
}

type Call = { sql: string; values: unknown[] }

function fakePool(options: {
  claimRows?: Array<{ id: string }>
  failAt?: 'order-line' | 'connect'
} = {}) {
  const calls: Call[] = []
  let released = 0
  let connected = 0

  const client: OrderPersistencePostgresClient = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.failAt === 'order-line' && sql.includes('INSERT INTO order_lines')) {
        throw Object.assign(new Error('unique constraint failed'), { code: '23505' })
      }
      let rows: Array<Record<string, unknown>> = []
      if (sql.includes('INSERT INTO order_create_idempotency')) {
        rows = options.claimRows ?? [{ id: INPUT.idempotencyId }]
      } else if (sql.includes('UPDATE order_create_idempotency')) {
        rows = [{ id: INPUT.idempotencyId }]
      } else if (sql.includes('INSERT INTO orders')) {
        rows = [{ order_id: INPUT.order.orderId }]
      } else if (sql.includes('INSERT INTO order_lines')) {
        rows = [{ order_line_id: INPUT.lines[0]!.orderLineId }]
      }
      return { rows: rows as Row[] }
    },
    release() { released += 1 },
  }

  const pool: OrderPersistencePostgresPool = {
    async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      return {
        rows: [{
          id: INPUT.idempotencyId,
          customer_id: INPUT.customerId,
          operation_key: INPUT.operationKey,
          idempotency_key: INPUT.idempotencyKey,
          request_hash: INPUT.requestHash,
          state: 'COMPLETED',
          response_status: 201,
          response_json: INPUT.responseJson,
          created_at: INPUT.createdAt,
          expires_at: INPUT.expiresAt,
        }] as Row[],
      }
    },
    async connect() {
      connected += 1
      if (options.failAt === 'connect') throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
      return client
    },
  }
  return { pool, calls, get released() { return released }, get connected() { return connected } }
}

describe('W07 PostgreSQL order-create persistence store', () => {
  it('reads customer-scoped idempotency rows with parameterized operation scope', async () => {
    const fake = fakePool()
    const store = createPostgresOrderCreateStore(fake.pool)

    const row = await store.readIdempotencyRow(INPUT.customerId, INPUT.idempotencyKey)

    expect(row).toMatchObject({
      id: INPUT.idempotencyId,
      customer_id: INPUT.customerId,
      operation_key: INPUT.operationKey,
      idempotency_key: INPUT.idempotencyKey,
      state: 'COMPLETED',
      response_json: INPUT.responseJson,
    })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.values).toEqual([
      INPUT.customerId,
      INPUT.operationKey,
      INPUT.idempotencyKey,
    ])
    expect(fake.calls[0]?.sql).toContain('customer_id = $1')
    expect(fake.calls[0]?.sql).toContain('operation_key = $2')
    expect(fake.calls[0]?.sql).toContain('idempotency_key = $3')
    expect(fake.calls[0]?.sql).toContain("AT TIME ZONE 'UTC'")
  })

  it('commits claim, response, Order and all OrderLines on one PostgreSQL client transaction', async () => {
    const fake = fakePool()
    const store = createPostgresOrderCreateStore(fake.pool)

    const result = await store.persistNewOrder(INPUT)

    expect(result).toEqual({
      statementCount: 5,
      expireChanges: 0,
      claimChanges: 1,
      completionChanges: 1,
      orderChanges: 1,
      lineChanges: [1],
    })
    expect(fake.calls.map((call) => call.sql.trim().split(/\\s+/)[0])).toEqual([
      'BEGIN',
      'DELETE',
      'INSERT',
      'UPDATE',
      'INSERT',
      'INSERT',
      'COMMIT',
    ])
    expect(fake.calls.filter((call) => call.sql.includes('INSERT INTO orders'))).toHaveLength(1)
    expect(fake.calls.filter((call) => call.sql.includes('INSERT INTO order_lines'))).toHaveLength(1)
    expect(fake.calls.every((call) => !call.sql.includes('?'))).toBe(true)
    expect(fake.released).toBe(1)
  })

  it('rolls back and returns a lost claim without inserting an Order', async () => {
    const fake = fakePool({ claimRows: [] })
    const store = createPostgresOrderCreateStore(fake.pool)

    const result = await store.persistNewOrder(INPUT)

    expect(result.claimChanges).toBe(0)
    expect(result.statementCount).toBe(2)
    expect(fake.calls.map((call) => call.sql.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('DELETE FROM order_create_idempotency'),
      expect.stringContaining('INSERT INTO order_create_idempotency'),
      'ROLLBACK',
    ])
    expect(fake.calls.some((call) => call.sql.includes('INSERT INTO orders'))).toBe(false)
    expect(fake.calls.some((call) => call.sql.includes('INSERT INTO order_lines'))).toBe(false)
    expect(fake.released).toBe(1)
  })

  it('rolls back the idempotency claim and Order when an OrderLine insert fails', async () => {
    const fake = fakePool({ failAt: 'order-line' })
    const store = createPostgresOrderCreateStore(fake.pool)

    await expect(store.persistNewOrder(INPUT)).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    })
    expect(fake.calls.at(-1)?.sql.trim()).toBe('ROLLBACK')
    expect(fake.calls.some((call) => call.sql.trim() === 'COMMIT')).toBe(false)
    expect(fake.released).toBe(1)
  })

  it('maps connection errors to a sanitized service-unavailable response', async () => {
    const fake = fakePool({ failAt: 'connect' })
    const store = createPostgresOrderCreateStore(fake.pool)

    const error = store.persistNewOrder(INPUT)
    await expect(error).rejects.toBeInstanceOf(OrderPersistenceError)
    await expect(error).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    })
    expect(fake.connected).toBe(1)
    expect(fake.calls).toHaveLength(0)
  })
})
