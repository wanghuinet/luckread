import { describe, expect, it, vi } from 'vitest'
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import { SubscriptionRuntimeError } from './subscription-runtime.js'
import { resolveRevenueCatMembershipProduct } from './membership-store-product-binding.js'

const appId = 'luckread-ios-production'
const productId = 'creator.gold:monthly:annual-commitment'
const store = 'APP_STORE'
const row = {
  plan_id: 'plan_' + 'a'.repeat(64),
  plan_version: 3,
  creator_id: 'creator_01',
  billing_interval: 'YEARLY',
}

function poolWith(result?: { rows: Array<Record<string, unknown>>; rowCount: number | null }, failure?: Error) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values })
    if (failure) throw failure
    return result ?? { rows: [], rowCount: 0 }
  })
  return {
    pool: { query, connect: vi.fn() } as unknown as W07WebhookPostgresPool,
    query,
    calls,
  }
}

describe('RevenueCat membership product binding on native Neon', () => {
  it('resolves a new purchase only to an active current public creator plan version', async () => {
    const f = poolWith({ rows: [row], rowCount: 1 })

    await expect(resolveRevenueCatMembershipProduct(f.pool, {
      revenueCatAppId: appId,
      store,
      productId,
      purpose: 'NEW_PURCHASE',
    })).resolves.toEqual({
      planId: row.plan_id,
      planVersion: 3,
      creatorId: 'creator_01',
      billingInterval: 'YEARLY',
    })

    expect(f.calls[0]?.sql).toContain('b.revenuecat_app_id = $1')
    expect(f.calls[0]?.sql).toContain('b.store = $2')
    expect(f.calls[0]?.sql).toContain('b.product_id = $3')
    expect(f.calls[0]?.sql).toContain("p.owner_type = 'CREATOR'")
    expect(f.calls[0]?.sql).toContain("b.status = 'ACTIVE'")
    expect(f.calls[0]?.sql).toContain("p.status = 'ACTIVE'")
    expect(f.calls[0]?.sql).toContain("p.visibility = 'PUBLIC'")
    expect(f.calls[0]?.sql).toContain('p.current_version = b.plan_version')
    expect(f.calls[0]?.values).toEqual([appId, store, productId])
    expect(f.calls[0]?.sql).not.toContain('__APP_ID__')
    expect(f.calls[0]?.sql).not.toContain('?')
  })

  it('allows retired product mappings only for existing provider transactions', async () => {
    const f = poolWith({ rows: [row], rowCount: 1 })

    await expect(resolveRevenueCatMembershipProduct(f.pool, {
      revenueCatAppId: appId,
      store,
      productId,
      purpose: 'EXISTING_TRANSACTION',
    })).resolves.toMatchObject({ planId: row.plan_id, planVersion: 3 })

    expect(f.calls[0]?.sql).toContain("b.status IN ('ACTIVE', 'RETIRED')")
    expect(f.calls[0]?.sql).not.toContain('p.current_version = b.plan_version')
    expect(f.calls[0]?.values).toEqual([appId, store, productId])
  })

  it('keeps missing product mappings as a not-found result', async () => {
    const f = poolWith()

    await expect(resolveRevenueCatMembershipProduct(f.pool, {
      revenueCatAppId: appId,
      store,
      productId,
      purpose: 'EXISTING_TRANSACTION',
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 })
  })

  it('sanitizes Neon read failures without exposing provider/database details', async () => {
    const f = poolWith(undefined, new Error('private database endpoint and credential'))

    await expect(resolveRevenueCatMembershipProduct(f.pool, {
      revenueCatAppId: appId,
      store,
      productId,
      purpose: 'EXISTING_TRANSACTION',
    })).rejects.toBeInstanceOf(SubscriptionRuntimeError)
    await expect(resolveRevenueCatMembershipProduct(f.pool, {
      revenueCatAppId: appId,
      store,
      productId,
      purpose: 'EXISTING_TRANSACTION',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
