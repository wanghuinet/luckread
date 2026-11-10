import { describe, expect, it, vi } from 'vitest'

import { createD1PaymentMethodReadStore } from './payment-method-read-store.js'
import {
  createPostgresPaymentMethodReadStore,
  type PaymentMethodPostgresQueryExecutor,
} from './payment-method-read-store-postgres.js'
import { PaymentMethodPersistenceError } from './payment-method-persistence.js'

const CUSTOMER_ID = 'customer_01'
const MERCHANT_ID = 'merchant_01'
const SAVED_METHOD_ID = 'spm_' + 's'.repeat(26)

type D1Call = { sql: string; values: unknown[] }

function fakeD1(allResults: Record<string, unknown[]>) {
  const calls: D1Call[] = []
  const db = {
    prepare(sql: string) {
      const call: D1Call = { sql, values: [] }
      calls.push(call)
      return {
        bind(...values: unknown[]) {
          call.values = values
          return this
        },
        async all<T>() {
          const key = sql.includes('FROM payment_mandates m JOIN saved_payment_methods s')
            ? 'mandates'
            : 'savedMethods'
          return { results: (allResults[key] ?? []) as T[] }
        },
      }
    },
  } as unknown as D1Database
  return { db, calls }
}

function fakePostgres(rowsByCall: unknown[][] = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async <Row extends Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ) => {
    calls.push({ sql, values })
    return { rows: (rowsByCall[calls.length - 1] ?? []) as Row[] }
  })
  const db: PaymentMethodPostgresQueryExecutor = { query }
  return { db, calls, query }
}

describe('W07 payment-method read store', () => {
  it('keeps D1 list ownership, status precedence, order bound and row mapping', async () => {
    const { db, calls } = fakeD1({
      savedMethods: [{
        saved_payment_method_id: SAVED_METHOD_ID,
        payment_method_id: 'hyperswitch_pm_01',
        created_at: '2026-11-10T08:00:00.000Z',
        mandate_status: 'ACTIVE',
        revocation_status: null,
      }],
    })

    const records = await createD1PaymentMethodReadStore(db)
      .listSavedPaymentMethodRecords(CUSTOMER_ID, MERCHANT_ID)

    expect(records).toEqual([{
      savedPaymentMethodId: SAVED_METHOD_ID,
      paymentMethodId: 'hyperswitch_pm_01',
      createdAt: '2026-11-10T08:00:00.000Z',
      mandateStatus: 'ACTIVE',
      revocationStatus: null,
    }])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['hyperswitch', MERCHANT_ID, CUSTOMER_ID])
    expect(calls[0]?.sql).toContain('LIMIT 100')
    expect(calls[0]?.sql).toContain("r.status <> 'COMPLETED'")
  })

  it('keeps D1 mandate ownership binding and deterministic order', async () => {
    const { db, calls } = fakeD1({
      mandates: [{
        mandate_record_id: 'mnd_' + 'm'.repeat(26),
        provider_mandate_id: 'hyperswitch_mandate_01',
        payment_method_id: 'hyperswitch_pm_01',
        status: 'ACTIVE',
      }],
    })

    const result = await createD1PaymentMethodReadStore(db)
      .getSavedPaymentMethodMandates(CUSTOMER_ID, MERCHANT_ID, SAVED_METHOD_ID)

    expect(result[0]).toMatchObject({
      mandateRecordId: 'mnd_' + 'm'.repeat(26),
      providerMandateId: 'hyperswitch_mandate_01',
      paymentMethodId: 'hyperswitch_pm_01',
      status: 'ACTIVE',
    })
    expect(calls[0]?.values).toEqual([SAVED_METHOD_ID, 'hyperswitch', MERCHANT_ID, CUSTOMER_ID])
    expect(calls[0]?.sql).toContain('ORDER BY m.created_at ASC, m.mandate_record_id ASC')
  })

  it('rejects an invalid saved-method id before D1 access', async () => {
    const { db, calls } = fakeD1({})
    await expect(createD1PaymentMethodReadStore(db)
      .getSavedPaymentMethodMandates(CUSTOMER_ID, MERCHANT_ID, 'invalid'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    expect(calls).toHaveLength(0)
  })

  it('uses PostgreSQL placeholders and keeps the exact merchant/customer ownership predicates', async () => {
    const { db, calls } = fakePostgres([[
      {
        saved_payment_method_id: SAVED_METHOD_ID,
        payment_method_id: 'hyperswitch_pm_01',
        created_at: '2026-11-10T08:00:00.000Z',
        mandate_status: 'PENDING_PROVIDER_CONFIRMATION',
        revocation_status: 'PENDING_PROVIDER',
      },
    ]])

    const result = await createPostgresPaymentMethodReadStore(db)
      .listSavedPaymentMethodRecords(CUSTOMER_ID, MERCHANT_ID)

    expect(result).toEqual([{
      savedPaymentMethodId: SAVED_METHOD_ID,
      paymentMethodId: 'hyperswitch_pm_01',
      createdAt: '2026-11-10T08:00:00.000Z',
      mandateStatus: 'PENDING_PROVIDER_CONFIRMATION',
      revocationStatus: 'PENDING_PROVIDER',
    }])
    expect(calls[0]?.values).toEqual(['hyperswitch', MERCHANT_ID, CUSTOMER_ID])
    expect(calls[0]?.sql).toContain('s.provider = $1')
    expect(calls[0]?.sql).toContain('s.merchant_id = $2')
    expect(calls[0]?.sql).toContain('s.customer_id = $3')
    expect(calls[0]?.sql).toContain('LIMIT 100')
  })

  it('uses an ownership-joined mandate query and rejects malformed ids without querying PG', async () => {
    const { db, calls } = fakePostgres([[
      {
        mandate_record_id: 'mnd_' + 'm'.repeat(26),
        provider_mandate_id: null,
        payment_method_id: 'hyperswitch_pm_01',
        status: 'PENDING_PROVIDER_CONFIRMATION',
      },
    ]])
    const store = createPostgresPaymentMethodReadStore(db)
    await expect(store.getSavedPaymentMethodMandates(CUSTOMER_ID, MERCHANT_ID, 'bad'))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    expect(calls).toHaveLength(0)

    const rows = await store.getSavedPaymentMethodMandates(CUSTOMER_ID, MERCHANT_ID, SAVED_METHOD_ID)
    expect(rows).toEqual([{
      mandateRecordId: 'mnd_' + 'm'.repeat(26),
      providerMandateId: null,
      paymentMethodId: 'hyperswitch_pm_01',
      status: 'PENDING_PROVIDER_CONFIRMATION',
    }])
    expect(calls[0]?.values).toEqual([SAVED_METHOD_ID, 'hyperswitch', MERCHANT_ID, CUSTOMER_ID])
    expect(calls[0]?.sql).toContain('JOIN saved_payment_methods s')
    expect(calls[0]?.sql).toContain('s.customer_id = $4')
    expect(calls[0]?.sql).toContain('ORDER BY m.created_at ASC, m.mandate_record_id ASC')
  })

  it('fails closed on PostgreSQL query errors', async () => {
    const db: PaymentMethodPostgresQueryExecutor = {
      async query() { throw new Error('connection unavailable') },
    }
    await expect(createPostgresPaymentMethodReadStore(db)
      .listSavedPaymentMethodRecords(CUSTOMER_ID, MERCHANT_ID))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('rejects malformed owner scope before querying PostgreSQL', async () => {
    const { db, calls } = fakePostgres([])
    await expect(createPostgresPaymentMethodReadStore(db)
      .listSavedPaymentMethodRecords(' customer_01', MERCHANT_ID))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(calls).toHaveLength(0)
  })
})
