import { describe, expect, it } from 'vitest'
import { handleCommerceBillingReadRequest } from './billing-read-http-runtime.js'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'

const CUSTOMER_ID = 'customer_history_001'

type Dependencies = NonNullable<Parameters<typeof handleCommerceBillingReadRequest>[3]>

function createFixture() {
  const calls = {
    documents: [] as unknown[][],
    payments: [] as unknown[][],
    refunds: [] as unknown[][],
  }
  const page = {
    items: [],
    nextCursor: null,
    hasMore: false,
  }
  const postgresPool = {} as W07WebhookPostgresPool
  const dependencies: Dependencies = {
    getPostgresPool: () => postgresPool,
    listBillingDocumentsPostgres: async (...args) => {
      calls.documents.push(args)
      return page
    },
    listPaymentHistoryPostgres: async (...args) => {
      calls.payments.push(args)
      return page
    },
    listRefundHistoryPostgres: async (...args) => {
      calls.refunds.push(args)
      return page
    },
  }
  const env: Parameters<typeof handleCommerceBillingReadRequest>[2] = {
    W07_DATABASE_DRIVER: 'neon',
  }
  return { calls, dependencies, env, postgresPool }
}

describe('W07 customer billing and payment history reads', () => {
  it('does not claim unrelated routes or non-GET routes', async () => {
    const f = createFixture()
    await expect(
      handleCommerceBillingReadRequest(
        new Request('https://luckread-w07.internal/commerce/orders'),
        CUSTOMER_ID,
        f.env,
        f.dependencies,
      ),
    ).resolves.toBeNull()

    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/history', { method: 'POST' }),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    )
    expect(response?.status).toBe(405)
    expect(f.calls.payments).toHaveLength(0)

    await expect(
      handleCommerceBillingReadRequest(
        new Request('https://luckread-w07.internal/commerce/payments/refunds', { method: 'POST' }),
        CUSTOMER_ID,
        f.env,
        f.dependencies,
      ),
    ).resolves.toBeNull()
    expect(f.calls.refunds).toHaveLength(0)
  })

  it('lists payment history through the native PostgreSQL store with bounded keyset pagination', async () => {
    const f = createFixture()
    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/history?limit=10&cursor=eyJ0aW1lc3RhbXAiOiIyMDI2LTEwLTMwVDEwOjAwOjAwLjAwMFoiLCJpZCI6InBheF8xIn0'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    )
    expect(response?.status).toBe(200)
    expect(f.calls.payments).toHaveLength(1)
    expect(f.calls.payments[0]?.slice(0, 4)).toEqual([
      f.postgresPool,
      CUSTOMER_ID,
      10,
      'eyJ0aW1lc3RhbXAiOiIyMDI2LTEwLTMwVDEwOjAwOjAwLjAwMFoiLCJpZCI6InBheF8xIn0',
    ])
    expect(response?.headers.get('cache-control')).toBe('no-store')
  })

  it('lists refunds and invoices through their dedicated customer-scoped PostgreSQL queries', async () => {
    const f = createFixture()
    const refund = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/refunds?limit=5'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    )
    const documents = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/billing/documents?limit=7'),
      CUSTOMER_ID,
      f.env,
      f.dependencies,
    )
    expect(refund?.status).toBe(200)
    expect(documents?.status).toBe(200)
    expect(f.calls.refunds[0]).toEqual([f.postgresPool, CUSTOMER_ID, 5, null])
    expect(f.calls.documents[0]).toEqual([f.postgresPool, CUSTOMER_ID, 7, null])
  })

  it('rejects unsupported query parameters, malformed page sizes and oversized cursors before any database query', async () => {
    for (const url of [
      'https://luckread-w07.internal/commerce/payments/history?offset=100',
      'https://luckread-w07.internal/commerce/payments/history?limit=51',
      'https://luckread-w07.internal/commerce/billing/documents?cursor=' + 'a'.repeat(513),
    ]) {
      const f = createFixture()
      const response = await handleCommerceBillingReadRequest(new Request(url), CUSTOMER_ID, f.env, f.dependencies)
      expect(response?.status).toBe(400)
      expect(f.calls.documents).toHaveLength(0)
      expect(f.calls.payments).toHaveLength(0)
      expect(f.calls.refunds).toHaveLength(0)
    }
  })

  it('fails closed when the Neon connection pool is unavailable', async () => {
    const f = createFixture()
    const dependencies: Dependencies = { ...f.dependencies, getPostgresPool: () => undefined }
    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/history'),
      CUSTOMER_ID,
      f.env,
      dependencies,
    )
    expect(response?.status).toBe(503)
  })

  it('maps PostgreSQL failures to sanitized responses', async () => {
    const f = createFixture()
    const dependencies: Dependencies = {
      ...f.dependencies,
      listRefundHistoryPostgres: async () => {
        throw new Error('database table name and raw SQL must not be exposed')
      },
    }
    const response = await handleCommerceBillingReadRequest(
      new Request('https://luckread-w07.internal/commerce/payments/refunds'),
      CUSTOMER_ID,
      f.env,
      dependencies,
    )
    expect(response?.status).toBe(503)
    const body = await response!.text()
    expect(body).toContain('SERVICE_UNAVAILABLE')
    expect(body).not.toContain('database table name')
    expect(body).not.toContain('raw SQL')
  })
})
