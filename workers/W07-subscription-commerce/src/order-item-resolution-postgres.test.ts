import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { resolveCommerceOrderItems } from './order-item-resolution.js'

const planId = 'plan_' + 'a'.repeat(64)
const createdAt = '2026-11-01T12:00:00.000Z'
const updatedAt = '2026-11-02T12:00:00.000Z'

function offerRow(overrides: Record<string, unknown> = {}) {
  return {
    plan_id: planId,
    owner_id: 'creator_01',
    current_version: 4,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    version: 7,
    created_at: createdAt,
    updated_at: updatedAt,
    name: 'Supporter',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: 1200,
    currency: 'USD',
    benefits_json: JSON.stringify(['member-posts', 'supporter-badge']),
    trial_period_days: 7,
    ...overrides,
  }
}

function nativePool(
  handler: (sql: string, values: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>
    rowCount: number | null
  }>,
) {
  const query = vi.fn((sql: string, values: unknown[] = []) => handler(sql, values))
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
  }
}

describe('W07 native PostgreSQL commerce order item resolution', () => {
  it('resolves the immutable current plan version, server price and offer snapshot', async () => {
    const pg = nativePool(async () => ({
      rows: [offerRow()],
      rowCount: 1,
    }))

    const result = await resolveCommerceOrderItems(pg.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })

    expect(result).toMatchObject({
      currency: 'USD',
      items: [{
        itemType: 'MEMBERSHIP_PLAN',
        itemRef: planId,
        itemVersion: '4',
        quantity: 1,
        unitAmountMinor: 1200,
        currency: 'USD',
      }],
    })
    expect(JSON.parse(result.items[0]!.itemSnapshotJson)).toEqual({
      planId,
      planVersion: 4,
      creatorId: 'creator_01',
      name: 'Supporter',
      tier: 'supporter',
      billingInterval: 'MONTHLY',
      priceMinor: 1200,
      currency: 'USD',
      benefits: ['member-posts', 'supporter-badge'],
    })
    expect(pg.query).toHaveBeenCalledTimes(1)
    const [sql, values] = pg.query.mock.calls[0]!
    expect(sql).toContain('v.plan_version = p.current_version')
    expect(sql).toContain("p.owner_type = 'CREATOR' AND p.status = 'ACTIVE' AND p.visibility = 'PUBLIC'")
    expect(sql).toContain('p.plan_id IN ($1)')
    expect(sql).toContain("to_char(p.created_at AT TIME ZONE 'UTC'")
    expect(values).toEqual([planId])
  })

  it('returns resource-not-found for private, draft, non-creator or missing-version offers', async () => {
    const pg = nativePool(async () => ({ rows: [], rowCount: 0 }))

    await expect(resolveCommerceOrderItems(pg.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })

  it('sanitizes PostgreSQL offer query failures', async () => {
    const pg = nativePool(async () => {
      throw new Error('private Neon connection string and credentials')
    })

    await expect(resolveCommerceOrderItems(pg.pool, {
      items: [{ itemRef: planId, quantity: 1 }],
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(pg.query).toHaveBeenCalledTimes(1)
  })

  it('rejects unsupported item references before invoking PostgreSQL', async () => {
    const pg = nativePool(async () => ({ rows: [], rowCount: 0 }))

    await expect(resolveCommerceOrderItems(pg.pool, {
      items: [{ itemRef: 'content_article_01', quantity: 1 }],
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
    expect(pg.query).not.toHaveBeenCalled()
  })
})
