import { describe, expect, it, vi } from 'vitest'

import type { AuditEvent } from './audit-event.js'
import type { AuditEventStore } from './audit-event-store.js'

const { getAuditEventStore } = vi.hoisted(() => ({
  getAuditEventStore: vi.fn(),
}))

vi.mock('./neon/moderation-database-runtime.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./neon/moderation-database-runtime.js')>()),
  getW06AuditEventStore: getAuditEventStore,
}))

import worker from './index'

function createStore() {
  const rows = new Map<string, AuditEvent>()
  const findByEventId = vi.fn(async (eventId: string) => rows.get(eventId) ?? null)
  const append = vi.fn(async (event: AuditEvent) => {
    if (rows.has(event.eventId)) throw new Error('duplicate audit event')
    rows.set(event.eventId, event)
  })
  const store: AuditEventStore = { findByEventId, append }
  return { store, rows, findByEventId, append }
}

const env = {
  HYPERDRIVE_D1_03: {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
  },
}

function request(body: unknown, requestId: string, layer = 'L3'): Request {
  return new Request('https://w06.internal/internal/audit-events/membership-plan-update-requested', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': 'creator_user_001',
      'X-LuckRead-Principal-Layer': layer,
      'X-LuckRead-Correlation-Id': 'membership-plan-update-audit',
      'X-LuckRead-Request-Id': requestId,
    },
    body: JSON.stringify(body),
  })
}

const planId = 'plan_' + 'a'.repeat(64)
const idempotencyKey = 'plan_update_0001'
const input = {
  eventId: 'evt_mpl_update_requested_' + planId + '_' + idempotencyKey,
  planId,
  creatorId: 'creator_001',
  expectedVersion: 2,
  idempotencyKey,
  name: 'Supporter',
  tier: 'supporter',
  billingInterval: 'MONTHLY',
  priceMinor: 500,
  currency: 'USD',
  benefits: ['Early access'],
}

describe('W06 direct AuditEvent HTTP persistence', () => {
  it('persists a native immutable AuditEvent through the Store without a D1 facade', async () => {
    const fake = createStore()
    getAuditEventStore.mockReturnValue(fake.store)

    const response = await worker.fetch(request(input, 'req_plan_update_first'), env as never)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      eventId: input.eventId,
      action: 'membership.plan.update_requested',
      targetType: 'MembershipPlan',
      targetId: planId,
      replayed: false,
    })
    expect(fake.findByEventId).toHaveBeenCalledWith(input.eventId)
    expect(fake.append).toHaveBeenCalledOnce()
    expect(fake.rows.get(input.eventId)).toMatchObject({
      actor: { actorId: 'creator_user_001', actorType: 'user', layer: 'L3' },
      action: 'membership.plan.update_requested',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: { creatorId: 'creator_001', expectedVersion: 2, planVersion: 1 },
      after: {
        creatorId: 'creator_001',
        expectedVersion: 2,
        planVersion: 2,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        version: 3,
        name: 'Supporter',
        tier: 'supporter',
        billingInterval: 'MONTHLY',
        priceMinor: 500,
        currency: 'USD',
        benefits: ['Early access'],
      },
    })
  })

  it('confirms a semantic request replay and rejects conflicting business facts', async () => {
    const fake = createStore()
    getAuditEventStore.mockReturnValue(fake.store)

    const first = await worker.fetch(request(input, 'req_plan_update_first'), env as never)
    const replay = await worker.fetch(request(input, 'req_plan_update_retry'), env as never)

    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({
      eventId: input.eventId,
      action: 'membership.plan.update_requested',
      replayed: true,
    })
    expect(fake.append).toHaveBeenCalledOnce()

    const conflict = await worker.fetch(
      request({ ...input, priceMinor: 900 }, 'req_plan_update_conflict'),
      env as never,
    )
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toEqual({ error: 'AUDIT_EVENT_CONFLICT' })
    expect(fake.append).toHaveBeenCalledOnce()
  })

  it('rejects invalid transport and payload before Store access', async () => {
    const fake = createStore()
    getAuditEventStore.mockReturnValue(fake.store)

    const denied = await worker.fetch(request(input, 'req_plan_update_l1', 'L1'), env as never)
    expect(denied.status).toBe(403)

    const invalid = await worker.fetch(
      request({ ...input, priceMinor: -1 }, 'req_plan_update_invalid'),
      env as never,
    )
    expect(invalid.status).toBe(400)
    expect(fake.findByEventId).not.toHaveBeenCalled()
    expect(fake.append).not.toHaveBeenCalled()
  })

  it('fails closed and confirms an identical concurrent insert winner', async () => {
    const failingStore: AuditEventStore = {
      async findByEventId() { return null },
      async append() { throw new Error('sensitive PostgreSQL error') },
    }
    getAuditEventStore.mockReturnValue(failingStore)
    const failed = await worker.fetch(request(input, 'req_plan_update_failed'), env as never)
    expect(failed.status).toBe(503)
    await expect(failed.json()).resolves.toEqual({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' })

    const winner: AuditEvent = {
      eventId: input.eventId,
      requestId: 'req_plan_update_winner',
      traceId: 'membership-plan-update-audit',
      actor: { actorId: 'creator_user_001', actorType: 'user', layer: 'L3' },
      action: 'membership.plan.update_requested',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: { creatorId: 'creator_001', expectedVersion: 2, planVersion: 1 },
      after: {
        creatorId: 'creator_001',
        expectedVersion: 2,
        planVersion: 2,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        version: 3,
        name: 'Supporter',
        tier: 'supporter',
        billingInterval: 'MONTHLY',
        priceMinor: 500,
        currency: 'USD',
        benefits: ['Early access'],
      },
      occurredAt: '2026-11-19T00:00:00.000Z',
    }
    const racedStore: AuditEventStore = {
      async findByEventId() { return winner },
      async append() { throw new Error('unique event_id conflict') },
    }
    getAuditEventStore.mockReturnValue(racedStore)
    const raced = await worker.fetch(request(input, 'req_plan_update_raced'), env as never)
    expect(raced.status).toBe(200)
    await expect(raced.json()).resolves.toMatchObject({ eventId: input.eventId, replayed: true })
  })
})
