import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import { resolveCommerceOrderItems } from './order-item-resolution.js'

const planId = 'plan_' + 'a'.repeat(64)
const createdAt = '2026-11-18T12:00:00.000Z'
const planRow = {
  plan_id: planId,
  owner_id: 'creator_01',
  current_version: 3,
  status: 'ACTIVE',
  visibility: 'PUBLIC',
  version: 4,
  created_at: createdAt,
  updated_at: createdAt,
  name: 'Supporter',
  tier: 'supporter',
  billing_interval: 'YEARLY',
  price_minor: 4900,
  price_mode: 'FIXED',
  minimum_price_minor: null,
  suggested_price_minor: null,
  maximum_price_minor: null,
  currency: 'USD',
  benefits_json: JSON.stringify(['Member posts', 'Archive access']),
  trial_period_days: 7,
}

function poolWith(
  rows: Array<Record<string, unknown>> = [planRow],
  failure?: Error,
) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (failure) throw failure
    return { rows, rowCount: rows.length }
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
    calls,
  }
}

describe('PAY-002 native PostgreSQL membership offer resolution', () => {
  it('builds the OrderLine price and immutable offer snapshot from the current public Neon plan version', async () => {
    const f = poolWith()

    const result = await resolveCommerceOrderItems(f.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })

    expect(result.currency).toBe('USD')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({
      itemType: 'MEMBERSHIP_PLAN',
      itemRef: planId,
      itemVersion: '3',
      quantity: 1,
      unitAmountMinor: 4900,
      currency: 'USD',
    })
    expect(JSON.parse(result.items[0]!.itemSnapshotJson)).toEqual({
      planId,
      planVersion: 3,
      creatorId: 'creator_01',
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'YEARLY',
      priceMinor: 4900,
      priceMode: 'FIXED',
      currency: 'USD',
      benefits: ['Member posts', 'Archive access'],
    })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]?.sql).toContain('p.plan_id = ANY($1::text[])')
    expect(f.calls[0]?.sql).toContain('v.plan_version = p.current_version')
    expect(f.calls[0]?.sql).toContain("p.owner_type = 'CREATOR'")
    expect(f.calls[0]?.sql).toContain("p.status = 'ACTIVE'")
    expect(f.calls[0]?.sql).toContain("p.visibility = 'PUBLIC'")
    expect(f.calls[0]?.values).toEqual([[planId]])
  })

  it('resolves a flexible selected amount within the immutable plan-version range', async () => {
    const f = poolWith([{
      ...planRow,
      price_minor: null,
      price_mode: 'FLEXIBLE',
      minimum_price_minor: 1500,
      suggested_price_minor: 2500,
      maximum_price_minor: 5000,
    }])

    const result = await resolveCommerceOrderItems(f.pool, {
      items: [{ itemRef: planId, quantity: 1, selectedAmountMinor: 3200 }],
    })

    expect(result.items[0]).toMatchObject({ unitAmountMinor: 3200, itemVersion: '3' })
    expect(JSON.parse(result.items[0]!.itemSnapshotJson)).toMatchObject({
      planId,
      planVersion: 3,
      priceMode: 'FLEXIBLE',
      minimumPriceMinor: 1500,
      suggestedPriceMinor: 2500,
      maximumPriceMinor: 5000,
      selectedAmountMinor: 3200,
      currency: 'USD',
    })
  })

  it('rejects flexible amounts outside the versioned range and requires a buyer selection', async () => {
    for (const selectedAmountMinor of [undefined, 1499, 5001]) {
      const f = poolWith([{
        ...planRow,
        price_minor: null,
        price_mode: 'FLEXIBLE',
        minimum_price_minor: 1500,
        suggested_price_minor: 2500,
        maximum_price_minor: 5000,
      }])
      const item = { itemRef: planId, quantity: 1, ...(selectedAmountMinor === undefined ? {} : { selectedAmountMinor }) }
      await expect(resolveCommerceOrderItems(f.pool, { items: [item] }))
        .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    }
  })

  it('does not resolve a private, draft, retired or missing-current-version offer', async () => {
    const f = poolWith([])

    await expect(resolveCommerceOrderItems(f.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })

  it('maps native database failures to a sanitized service error', async () => {
    const f = poolWith([], new Error('private Neon connection details'))

    await expect(resolveCommerceOrderItems(f.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })).rejects.toBeInstanceOf(SubscriptionRuntimeError)
    await expect(resolveCommerceOrderItems(f.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
