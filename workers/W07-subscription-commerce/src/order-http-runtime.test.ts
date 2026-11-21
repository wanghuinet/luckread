import { describe, expect, it, vi } from 'vitest'
import {
  createCommerceOrder,
  OrderPersistenceError,
  type CreateOrderResult,
  type CommerceOrderData,
  type AuthoritativelyPricedOrder,
  type OrderCreatePersistenceStore,
} from './order-persistence.js'
import { handleCommerceOrderRequest } from './order-http-runtime.js'
import { getCommerceOrderPostgres } from './order-read-postgres.js'
import { issueInvoiceForOrderPostgres } from './billing-document-postgres-persistence.js'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'

const env: Parameters<typeof handleCommerceOrderRequest>[2] = {}

const orderData: CommerceOrderData = {
  orderId: 'ord_test_1',
  status: 'CREATED',
  version: 1,
  currency: 'USD',
  subtotalMinor: 1200,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 1200,
  items: [{
    itemRef: 'plan_' + 'a'.repeat(64),
    quantity: 1,
    unitAmountMinor: 1200,
    lineSubtotalMinor: 1200,
    lineDiscountMinor: 0,
    lineTaxMinor: 0,
    lineTotalMinor: 1200,
  }],
  createdAt: '2026-10-28T12:00:00.000Z',
  updatedAt: '2026-10-28T12:00:00.000Z',
}

const createResult: CreateOrderResult = { data: orderData, status: 201, replayed: false }

const explicitTestPricing: AuthoritativelyPricedOrder = {
  currency: 'USD',
  items: [{
    itemType: 'MEMBERSHIP_PLAN',
    itemRef: 'plan_' + 'a'.repeat(64),
    itemVersion: '1',
    quantity: 1,
    unitAmountMinor: 1200,
    currency: 'USD',
    lineDiscountMinor: 0,
    lineTaxMinor: 0,
    itemSnapshotJson: JSON.stringify({ planId: 'plan_' + 'a'.repeat(64), planVersion: 1 }),
  }],
}

function postRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://luckread-w07.internal/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function parseResponse(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

function orderCreateStore(): OrderCreatePersistenceStore {
  return {
    async readIdempotencyRow() { return null },
    async persistNewOrder() {
      return {
        statementCount: 5,
        expireChanges: 0,
        claimChanges: 1,
        completionChanges: 1,
        orderChanges: 1,
        lineChanges: [1],
      }
    },
  }
}

describe('private W07 Neon commerce order HTTP handler', () => {
  it('does not claim routes outside the commerce order namespace', async () => {
    await expect(
      handleCommerceOrderRequest(
        new Request('https://luckread-w07.internal/plans'),
        'user_1',
        env,
      ),
    ).resolves.toBeNull()
  })

  it('creates an order using the authenticated principal, Neon order store and idempotent PostgreSQL invoice issuance', async () => {
    let captured: Parameters<typeof createCommerceOrder> | undefined
    let invoiceCall: Parameters<typeof issueInvoiceForOrderPostgres> | undefined
    const postgresPool = {} as W07WebhookPostgresPool
    const postgresStore = orderCreateStore()
    const mockCreate = (async (...args: Parameters<typeof createCommerceOrder>) => {
      captured = args
      return createResult
    }) as typeof createCommerceOrder
    const mockInvoice = (async (...args: Parameters<typeof issueInvoiceForOrderPostgres>) => {
      invoiceCall = args
      return {} as Awaited<ReturnType<typeof issueInvoiceForOrderPostgres>>
    }) as typeof issueInvoiceForOrderPostgres

    const response = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }, {
        'Idempotency-Key': 'purchase_attempt_01',
      }),
      'user_42',
      env,
      {
        getPostgresPool: () => postgresPool,
        getOrderCreateStore: () => postgresStore,
        createOrder: mockCreate,
        issueInvoice: mockInvoice,
        resolvePricing: async () => explicitTestPricing,
      },
    )

    expect(response?.status).toBe(201)
    expect(captured?.[0]).toBe(postgresStore)
    expect(captured?.[1]).toBe('user_42')
    expect(captured?.[2]).toBe('purchase_attempt_01')
    expect(captured?.[3]).toEqual({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] })
    expect(invoiceCall?.slice(0, 2)).toEqual([postgresPool, 'user_42'])
    expect(invoiceCall?.[2]).toBe(orderData.orderId)
    const envelope = await parseResponse(response!)
    expect(envelope.data).toEqual(orderData)
    expect(envelope.requestId).toMatch(/^req_/)
    expect(JSON.stringify(envelope)).not.toContain('customerId')
    expect(JSON.stringify(envelope)).not.toContain('itemSnapshotJson')
  })

  it('fails closed if either Neon store or finance pool is unavailable before writing an Order', async () => {
    let writes = 0
    const mockCreate = (async () => {
      writes += 1
      return createResult
    }) as unknown as typeof createCommerceOrder

    const missingStore = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }, {
        'Idempotency-Key': 'purchase_attempt_02',
      }),
      'user_42',
      env,
      {
        getPostgresPool: () => ({} as W07WebhookPostgresPool),
        getOrderCreateStore: () => undefined,
        createOrder: mockCreate,
        resolvePricing: async () => explicitTestPricing,
      },
    )
    const missingPool = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }, {
        'Idempotency-Key': 'purchase_attempt_03',
      }),
      'user_42',
      env,
      {
        getPostgresPool: () => undefined,
        getOrderCreateStore: () => orderCreateStore(),
        createOrder: mockCreate,
        resolvePricing: async () => explicitTestPricing,
      },
    )

    expect(missingStore?.status).toBe(503)
    expect(missingPool?.status).toBe(503)
    expect(writes).toBe(0)
  })

  it('keeps order creation disabled when no authoritative discount/tax pricing adapter is wired', async () => {
    let writes = 0
    const mockCreate = (async () => {
      writes += 1
      return createResult
    }) as unknown as typeof createCommerceOrder
    const response = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }, {
        'Idempotency-Key': 'purchase_attempt_04',
      }),
      'user_42',
      env,
      { createOrder: mockCreate },
    )

    expect(response?.status).toBe(503)
    expect(await parseResponse(response!)).toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    })
    expect(writes).toBe(0)
  })

  it('fails closed on missing Idempotency-Key before attempting Neon access', async () => {
    const getPostgresPool = vi.fn()
    const getOrderCreateStore = vi.fn()
    const response = await handleCommerceOrderRequest(
      postRequest({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] }),
      'user_42',
      env,
      { getPostgresPool, getOrderCreateStore },
    )

    expect(response?.status).toBe(428)
    expect(await parseResponse(response!)).toMatchObject({
      error: { code: 'PRECONDITION_REQUIRED' },
    })
    expect(getPostgresPool).not.toHaveBeenCalled()
    expect(getOrderCreateStore).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and non-JSON content types before calling persistence', async () => {
    const malformed = new Request('https://luckread-w07.internal/commerce/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'key_01' },
      body: '{"items":',
    })
    const malformedResponse = await handleCommerceOrderRequest(malformed, 'user_42', env)
    expect(malformedResponse?.status).toBe(400)
    expect(await parseResponse(malformedResponse!)).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })

    const wrongType = new Request('https://luckread-w07.internal/commerce/orders', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'Idempotency-Key': 'key_01' },
      body: '{"items":[]}',
    })
    expect((await handleCommerceOrderRequest(wrongType, 'user_42', env))?.status).toBe(400)
  })

  it('rejects oversized streamed bodies before invoking order persistence', async () => {
    let writes = 0
    const mockCreate = (async () => {
      writes += 1
      return createResult
    }) as unknown as typeof createCommerceOrder
    const response = await handleCommerceOrderRequest(
      postRequest({ padded: 'x'.repeat(17_000) }, { 'Idempotency-Key': 'key_01' }),
      'user_42',
      env,
      { createOrder: mockCreate },
    )
    expect(response?.status).toBe(400)
    expect(writes).toBe(0)
  })

  it('reads an order through the owner-scoped Neon reader and emits only the admitted DTO', async () => {
    let captured: Parameters<typeof getCommerceOrderPostgres> | undefined
    const pool = {} as W07WebhookPostgresPool
    const mockGet = (async (...args: Parameters<typeof getCommerceOrderPostgres>) => {
      captured = args
      return orderData
    }) as typeof getCommerceOrderPostgres
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1'),
      'user_42',
      env,
      { getPostgresPool: () => pool, getOrder: mockGet },
    )

    expect(response?.status).toBe(200)
    expect(captured).toEqual([pool, 'user_42', 'ord_test_1'])
    const envelope = await parseResponse(response!)
    expect(envelope.data).toEqual(orderData)
    expect(JSON.stringify(envelope)).not.toContain('customer_id')
    expect(JSON.stringify(envelope)).not.toContain('item_snapshot_json')
  })

  it('fails closed when the Neon finance pool is unavailable for order reads', async () => {
    const getOrder = vi.fn(async () => orderData)
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1'),
      'user_42',
      env,
      {
        getPostgresPool: () => undefined,
        getOrder: getOrder as unknown as typeof getCommerceOrderPostgres,
      },
    )

    expect(response?.status).toBe(503)
    expect(getOrder).not.toHaveBeenCalled()
  })

  it('maps owner-scoped not-found without leaking whether another user owns the Order', async () => {
    const mockGet = (async () => {
      throw new OrderPersistenceError('RESOURCE_NOT_FOUND', 404)
    }) as unknown as typeof getCommerceOrderPostgres
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_other'),
      'user_42',
      env,
      { getPostgresPool: () => ({} as W07WebhookPostgresPool), getOrder: mockGet },
    )

    expect(response?.status).toBe(404)
    expect(await parseResponse(response!)).toMatchObject({
      error: { code: 'RESOURCE_NOT_FOUND', message: 'Order not found' },
    })
  })

  it('returns not-found for methods and paths outside the admitted create/read operations', async () => {
    const badMethod = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1', { method: 'DELETE' }),
      'user_42',
      env,
    )
    expect(badMethod?.status).toBe(404)

    const badShape = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders'),
      'user_42',
      env,
    )
    expect(badShape?.status).toBe(404)
  })

  it('maps unavailable database failures to a sanitized response without leaking SQL details', async () => {
    const mockGet = (async () => {
      throw new Error('relation orders does not exist; sensitive SQL')
    }) as unknown as typeof getCommerceOrderPostgres
    const response = await handleCommerceOrderRequest(
      new Request('https://luckread-w07.internal/commerce/orders/ord_test_1'),
      'user_42',
      env,
      { getPostgresPool: () => ({} as W07WebhookPostgresPool), getOrder: mockGet },
    )

    expect(response?.status).toBe(503)
    const envelope = await parseResponse(response!)
    expect(envelope).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
    expect(JSON.stringify(envelope)).not.toContain('relation orders')
    expect(JSON.stringify(envelope)).not.toContain('sensitive SQL')
  })
})
