import { describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from './audit-event'
import type { AuditEventStore } from './audit-event-store.js'

const { auditEventStoresByBinding, queueReadStoreOverride } = vi.hoisted(() => ({
  auditEventStoresByBinding: new WeakMap<object, unknown>(),
  queueReadStoreOverride: { current: undefined as unknown },
}))

vi.mock('./neon/moderation-database-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./neon/moderation-database-runtime.js')>()
  return {
    ...actual,
    getW06AuditEventStore: (env: { HYPERDRIVE_NEON_GOVERNANCE?: object }) => {
      const binding = env.HYPERDRIVE_NEON_GOVERNANCE
      const registration = binding
        ? auditEventStoresByBinding.get(binding) as { store?: AuditEventStore } | undefined
        : undefined
      if (!registration?.store) throw new Error('AUDIT_EVENT_TEST_STORE_NOT_REGISTERED')
      return registration.store
    },
    getW06ModerationQueueReadStore: (env: unknown) =>
      queueReadStoreOverride.current ?? actual.getW06ModerationQueueReadStore(env as never),
  }
})

function registerAuditEventStoreTestDouble(binding: object, writeSuccess = true) {
  const existing = auditEventStoresByBinding.get(binding) as {
    store: AuditEventStore
    rows: Map<string, AuditEvent>
    append: ReturnType<typeof vi.fn>
    findByEventId: ReturnType<typeof vi.fn>
  } | undefined
  if (existing) return existing
  const rows = new Map<string, AuditEvent>()
  const append = vi.fn(async (event: AuditEvent) => {
    if (!writeSuccess) throw new Error('AUDIT_EVENT_PERSISTENCE_FAILED')
    if (rows.has(event.eventId)) throw new Error('AUDIT_EVENT_CONFLICT')
    rows.set(event.eventId, event)
  })
  const findByEventId = vi.fn(async (eventId: string) => rows.get(eventId) ?? null)
  const store: AuditEventStore = { findByEventId, append }
  const registration = { store, rows, append, findByEventId }
  auditEventStoresByBinding.set(binding, registration)
  return registration
}

const eventInput = {
  eventId: 'evt-runtime-1',
  requestId: 'req_runtime-1',
  traceId: 'trace-runtime-1',
  actor: {
    actorId: 'admin-1',
    actorType: 'admin',
    layer: 'L7',
  },
  userId: 'user-001',
  beforeState: 'PENDING_VERIFICATION',
  beforeVersion: 1,
  afterState: 'ACTIVE',
  afterVersion: 2,
  occurredAt: '2026-09-24T08:30:00.000Z',
  reason: 'verification completed',
}

const auditStoreTestEnv = (binding: object) => {
  registerAuditEventStoreTestDouble(binding)
  return { HYPERDRIVE_NEON_GOVERNANCE: binding }
}

function createDb(writeSuccess = true) {
  const db = { connectionString: 'postgresql://test.local/luckread_governance' }
  return { db, ...registerAuditEventStoreTestDouble(db, writeSuccess) }
}

describe('W06 canonical API error mapping', () => {
  it('preserves canonical codes before normalizing internal aliases', async () => {
    const runtime = await import('./index')
    expect(runtime.canonicalErrorCode('INVALID_STATE')).toBe('INVALID_STATE')
    expect(runtime.canonicalErrorCode('INVALID_CURSOR')).toBe('INVALID_CURSOR')
    expect(runtime.canonicalErrorCode('CURSOR_EXPIRED')).toBe('CURSOR_EXPIRED')
    expect(runtime.canonicalErrorCode('REPORT_WRITE_FAILED')).toBe('INTERNAL_ERROR')
    expect(runtime.canonicalErrorCode('INVALID_AUDIT_EVENT')).toBe('VALIDATION_FAILED')
  })
})

describe('W06 moderation queue pagination scope', () => {
  it('rejects queue cursors reused by a different reviewer before Store access', async () => {
    const rows = [
      {
        case_id: 'case_2',
        target_type: 'content',
        target_id: 'content_2',
        target_version: null,
        policy_version: 'policy-v1',
        state: 'OPEN',
        priority: 5,
        assigned_reviewer_id: null,
        current_decision_id: null,
        evidence_bundle_ref: null,
        version: 1,
        created_at: '2026-10-07T00:00:00.000000Z',
        updated_at: '2026-10-07T00:00:00.000000Z',
        decision_id: null,
        case_version: null,
        outcome: null,
        decision_policy_version: null,
        decision_effective_at: null,
        decision_request_id: null,
        decision_created_at: null,
      },
      {
        case_id: 'case_3',
        target_type: 'content',
        target_id: 'content_3',
        target_version: null,
        policy_version: 'policy-v1',
        state: 'OPEN',
        priority: 4,
        assigned_reviewer_id: null,
        current_decision_id: null,
        evidence_bundle_ref: null,
        version: 1,
        created_at: '2026-10-07T00:01:00.000000Z',
        updated_at: '2026-10-07T00:01:00.000000Z',
        decision_id: null,
        case_version: null,
        outcome: null,
        decision_policy_version: null,
        decision_effective_at: null,
        decision_request_id: null,
        decision_created_at: null,
      },
    ]
    const list = vi.fn(async () => rows)
    const queueStore = { list }
    queueReadStoreOverride.current = queueStore
    vi.resetModules()

    try {
      const runtime = await import('./index')
      const env = {
        HYPERDRIVE_NEON_GOVERNANCE: {
          connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
        },
      }
      const requestFor = (reviewerId: string, requestId: string, cursor?: string) =>
        new Request('https://w06.internal/admin/moderation/queue?limit=1' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), {
          headers: {
            'X-LuckRead-Caller': 'W01',
            'X-LuckRead-Transport-Version': '1.0',
            'X-LuckRead-Principal-User-Id': reviewerId,
            'X-LuckRead-Principal-Layer': 'L6',
            'X-LuckRead-Correlation-Id': 'correlation-' + reviewerId,
            'X-LuckRead-Request-Id': requestId,
            'X-LuckRead-Authz-Decision': 'ALLOW',
            'X-LuckRead-Authz-Permission': 'moderation.queue.read',
            'X-LuckRead-Authz-Resource-Type': 'ModerationQueue',
            'X-LuckRead-Authz-Policy-Version': 'casl-l0-l8-v1',
            'X-LuckRead-Authz-Subject-Id': reviewerId,
            'X-LuckRead-Authz-Layer': 'L6',
          },
        })

      const first = await runtime.default.fetch(requestFor('reviewer_1', 'req_queue_first'), env as never)
      expect(first.status).toBe(200)
      const payload = await first.json() as { nextCursor?: string }
      expect(payload.nextCursor).toEqual(expect.any(String))
      expect(payload.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(list).toHaveBeenCalledTimes(1)

      const reused = await runtime.default.fetch(
        requestFor('reviewer_2', 'req_queue_second', payload.nextCursor),
        env as never,
      )
      expect(reused.status).toBe(400)
      await expect(reused.json()).resolves.toMatchObject({
        error: { code: 'INVALID_CURSOR', details: {} },
        requestId: 'req_queue_second',
      })
      expect(list).toHaveBeenCalledTimes(1)
    } finally {
      queueReadStoreOverride.current = undefined
      vi.resetModules()
    }
  })
})

describe('W06 moderation permission proof', () => {
  it('fails closed for queue, case-read, and decision routes when W01 has not attached an allowed W08 CASL decision', async () => {
    const db = { connectionString: 'postgresql://test.local/luckread_governance' }
    const { append } = registerAuditEventStoreTestDouble(db)
    const runtime = await import('./index')
    const headers = {
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': 'reviewer_1',
      'X-LuckRead-Principal-Layer': 'L6',
      'X-LuckRead-Correlation-Id': 'moderation-authz-negative',
      'X-LuckRead-Request-Id': 'req_authz_negative',
    }
    const requests = [
      new Request('https://w06.internal/admin/moderation/queue', { headers }),
      new Request('https://w06.internal/admin/moderation/cases/case_1', { headers }),
      new Request('https://w06.internal/admin/moderation/cases/case_1/decision', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'If-Match': '"v1"', 'Idempotency-Key': 'idem_1' },
        body: JSON.stringify({
          decision: 'APPROVED', expectedVersion: 1, policyVersion: 'moderation-v1.0',
          reasonCode: 'POLICY_MATCH', severity: 'medium', scope: 'content',
          effectiveAt: '2026-10-01T00:00:00.000Z', expiresAt: null,
        }),
      }),
    ]
    for (const request of requests) {
      const response = await runtime.default.fetch(request, auditStoreTestEnv(db))
      expect(response.status).toBe(403)
    }
    expect(append).not.toHaveBeenCalled()
  })
})

describe('W06 runtime', () => {
  const planId = 'plan_' + 'a'.repeat(64)
  const planAuditInput = {
    eventId: 'evt_mpl_created_plan_' + 'a'.repeat(64),
    planId,
    creatorId: 'creator_001',
    planVersion: 1,
    status: 'DRAFT',
    visibility: 'PRIVATE',
    occurredAt: '2026-10-27T13:00:00.000Z',
    name: 'Supporter',
    tier: 'supporter',
    billingInterval: 'MONTHLY',
    priceMode: 'FIXED',
    priceMinor: 500,
    minimumPriceMinor: null,
    suggestedPriceMinor: null,
    maximumPriceMinor: null,
        offerKind: 'STANDARD',
        foundingCapacity: null,
    currency: 'USD',
  }
  const planAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_audit_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-created',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withTransport ? {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'creator_user_001',
          'X-LuckRead-Principal-Layer': layer,
          'X-LuckRead-Correlation-Id': 'plan-audit-correlation',
          'X-LuckRead-Request-Id': requestId,
        } : {}),
      },
      body: JSON.stringify(body),
    },
  )

  const publishAuditInput = {
    eventId: 'evt_mpl_published_' + planId + '_v2',
    planId,
    creatorId: 'creator_001',
    planVersion: 1,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    version: 2,
    occurredAt: '2026-10-28T04:00:00.000Z',
    name: 'Supporter',
    tier: 'supporter',
    billingInterval: 'MONTHLY',
    priceMode: 'FIXED',
    priceMinor: 500,
    minimumPriceMinor: null,
    suggestedPriceMinor: null,
    maximumPriceMinor: null,
        offerKind: 'STANDARD',
        foundingCapacity: null,
    currency: 'USD',
  }
  const planPublishAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_publish_audit_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-published',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withTransport ? {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'creator_user_001',
          'X-LuckRead-Principal-Layer': layer,
          'X-LuckRead-Correlation-Id': 'plan-publish-audit-correlation',
          'X-LuckRead-Request-Id': requestId,
        } : {}),
      },
      body: JSON.stringify(body),
    },
  )


  const publishRequestAuditInput = {
    eventId: 'evt_mpl_publish_requested_' + planId + '_v1',
    planId,
    creatorId: 'creator_001',
    expectedVersion: 1,
    requestedStatus: 'ACTIVE',
    requestedVisibility: 'PUBLIC',
  }
  const planPublishRequestAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_publish_intent_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-publish-requested',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withTransport ? {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'creator_user_001',
          'X-LuckRead-Principal-Layer': layer,
          'X-LuckRead-Correlation-Id': 'plan-publish-intent-correlation',
          'X-LuckRead-Request-Id': requestId,
        } : {}),
      },
      body: JSON.stringify(body),
    },
  )


  const updateAuditTerms = {
    name: 'Creator Plus',
    tier: 'plus',
    billingInterval: 'MONTHLY',
    priceMode: 'FIXED',
    priceMinor: 900,
    minimumPriceMinor: null,
    suggestedPriceMinor: null,
    maximumPriceMinor: null,
        offerKind: 'STANDARD',
        foundingCapacity: null,
    currency: 'USD',
    benefits: ['member-posts', 'monthly-live'],
  }
  const planUpdateRequestAuditInput = {
    eventId: 'evt_mpl_update_requested_' + planId + '_update_key_1',
    planId,
    creatorId: 'creator_001',
    expectedVersion: 2,
    idempotencyKey: 'update_key_1',
    ...updateAuditTerms,
  }
  const planUpdateRequestAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_update_intent_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-update-requested',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withTransport ? {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'creator_user_001',
          'X-LuckRead-Principal-Layer': layer,
          'X-LuckRead-Correlation-Id': 'plan-update-intent-correlation',
          'X-LuckRead-Request-Id': requestId,
          'Idempotency-Key': String((body as { idempotencyKey?: unknown }).idempotencyKey ?? ''),
        } : {}),
      },
      body: JSON.stringify(body),
    },
  )
  const planUpdatedAuditInput = {
    eventId: 'evt_mpl_updated_' + planId + '_v3',
    planId,
    creatorId: 'creator_001',
    expectedVersion: 2,
    planVersion: 2,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    version: 3,
    occurredAt: '2026-10-28T04:00:02.000Z',
    ...updateAuditTerms,
  }
  const planUpdatedAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_updated_audit_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-updated',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withTransport ? {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'creator_user_001',
          'X-LuckRead-Principal-Layer': layer,
          'X-LuckRead-Correlation-Id': 'plan-updated-audit-correlation',
          'X-LuckRead-Request-Id': requestId,
        } : {}),
      },
      body: JSON.stringify(body),
    },
  )

  const planLifecycleRequestAuditInput = {
    eventId: 'evt_mpl_lifecycle_requested_pause_' + planId + '_v2',
    planId, creatorId: 'creator_001', expectedVersion: 2, action: 'pause',
    requestedStatus: 'PAUSED', requestedVisibility: 'PRIVATE',
  }
  const planLifecycleRequestAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_lifecycle_intent_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-lifecycle-requested',
    { method: 'POST', headers: { 'content-type': 'application/json', ...(withTransport ? {
      'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': 'creator_user_001', 'X-LuckRead-Principal-Layer': layer,
      'X-LuckRead-Correlation-Id': 'plan-lifecycle-intent-correlation', 'X-LuckRead-Request-Id': requestId,
    } : {}) }, body: JSON.stringify(body) },
  )
  const planLifecycleAuditInput = {
    eventId: 'evt_mpl_plan_paused_' + planId + '_v3',
    planId, creatorId: 'creator_001', expectedVersion: 2, planVersion: 2,
    action: 'pause', status: 'PAUSED', visibility: 'PRIVATE', version: 3,
    occurredAt: '2026-10-28T06:00:00.000Z',
  }
  const planLifecycleRetireAuditInput = {
    eventId: 'evt_mpl_plan_retired_' + planId + '_v4',
    planId, creatorId: 'creator_001', expectedVersion: 3, planVersion: 2,
    action: 'retire', status: 'RETIRED', visibility: 'PRIVATE', version: 4,
    occurredAt: '2026-10-28T06:01:00.000Z',
  }
  const planLifecycleAuditRequest = (body: unknown, withTransport = true, requestId = 'req_plan_lifecycle_audit_1', layer = 'L3') => new Request(
    'https://w06.internal/internal/audit-events/membership-plan-lifecycle-changed',
    { method: 'POST', headers: { 'content-type': 'application/json', ...(withTransport ? {
      'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': 'creator_user_001', 'X-LuckRead-Principal-Layer': layer,
      'X-LuckRead-Correlation-Id': 'plan-lifecycle-correlation', 'X-LuckRead-Request-Id': requestId,
    } : {}) }, body: JSON.stringify(body) },
  )

  const orderId = 'ord_test_1'
  const orderAuditInput = {
    eventId: 'evt_order_created_' + orderId,
    orderId,
    occurredAt: '2026-10-28T03:00:00.000Z',
    status: 'CREATED',
    version: 1,
    currency: 'USD',
    subtotalMinor: 1200,
    discountMinor: 100,
    taxMinor: 88,
    totalMinor: 1188,
  }
  const orderAuditRequest = (body: unknown, withTransport = true, requestId = 'req_order_audit_1', layer = 'L2') => new Request(
    'https://w06.internal/internal/audit-events/commerce-order-created',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withTransport ? {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'buyer_user_001',
          'X-LuckRead-Principal-Layer': layer,
          'X-LuckRead-Correlation-Id': 'order-audit-correlation',
          'X-LuckRead-Request-Id': requestId,
        } : {}),
      },
      body: JSON.stringify(body),
    },
  )
  const createPlanAuditDb = (writeSuccess = true) => {
    const db = { connectionString: 'postgresql://test.local/luckread_governance' }
    return { db, ...registerAuditEventStoreTestDouble(db, writeSuccess) }
  }

  it('requires the private W01 transport for membership-plan audit writes', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planAuditRequest(planAuditInput, false), auditStoreTestEnv(db))
    expect(response.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects membership-plan audit requests below creator-capable layers', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(
      planAuditRequest(planAuditInput, true, 'req_plan_audit_l2', 'L2'),
      auditStoreTestEnv(db),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'PERMISSION_DENIED' })
    expect(append).not.toHaveBeenCalled()
  })

  it('accepts higher creator-capable layers and records the actual W01 layer', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(
      planAuditRequest(planAuditInput, true, 'req_plan_audit_l7', 'L7'),
      auditStoreTestEnv(db),
    )
    expect(response.status).toBe(201)
    expect(rows.get(planAuditInput.eventId)).toMatchObject({
      actor: { actorId: 'creator_user_001', actorType: 'user', layer: 'L7' },
      action: 'membership.plan.created',
      targetId: planId,
    })
  })

  it('persists a canonical membership-plan creation event using the W01 principal', async () => {
    const { db, append, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planAuditRequest(planAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      eventId: planAuditInput.eventId,
      action: 'membership.plan.created',
      targetType: 'MembershipPlan',
      targetId: planId,
      replayed: false,
    })
    expect(append).toHaveBeenCalledTimes(1)
    const row = rows.get(planAuditInput.eventId)
    expect(row).toMatchObject({
      actor: { actorId: 'creator_user_001', actorType: 'user', layer: 'L3' },
      action: 'membership.plan.created',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: {},
      after: {
        creatorId: 'creator_001',
        planVersion: 1,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        name: 'Supporter',
        tier: 'supporter',
        billingInterval: 'MONTHLY',
        priceMode: 'FIXED',
        priceMinor: 500,
        minimumPriceMinor: null,
        suggestedPriceMinor: null,
        maximumPriceMinor: null,
        offerKind: 'STANDARD',
        foundingCapacity: null,
        currency: 'USD',
      },
      occurredAt: planAuditInput.occurredAt,
    })
  })

  it('accepts and immutably records flexible membership price bounds', async () => {
    const { db, rows, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const flexibleInput = {
      ...planAuditInput,
      priceMode: 'FLEXIBLE',
      priceMinor: null,
      minimumPriceMinor: 500,
      suggestedPriceMinor: 1200,
      maximumPriceMinor: 5000,
    }
    const response = await runtime.default.fetch(planAuditRequest(flexibleInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(append).toHaveBeenCalledTimes(1)
    expect(rows.get(planAuditInput.eventId)?.after).toMatchObject({
      priceMode: 'FLEXIBLE',
      priceMinor: null,
      minimumPriceMinor: 500,
      suggestedPriceMinor: 1200,
      maximumPriceMinor: 5000,
    })
  })

  it('rejects inconsistent flexible membership price bounds before persistence', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planAuditRequest({
      ...planAuditInput,
      priceMode: 'FLEXIBLE',
      priceMinor: null,
      minimumPriceMinor: 1500,
      suggestedPriceMinor: 1200,
      maximumPriceMinor: 5000,
    }), auditStoreTestEnv(db))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_MEMBERSHIP_PLAN_AUDIT' })
    expect(append).not.toHaveBeenCalled()
  })

  it('accepts and immutably records a founding membership offer and its capacity', async () => {
    const { db, rows, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const foundingInput = {
      ...planAuditInput,
      name: 'Founding Member',
      tier: 'founding',
      priceMinor: 9900,
      offerKind: 'FOUNDING',
      foundingCapacity: 100,
    }
    const response = await runtime.default.fetch(planAuditRequest(foundingInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(append).toHaveBeenCalledTimes(1)
    expect(rows.get(planAuditInput.eventId)?.after).toMatchObject({
      offerKind: 'FOUNDING',
      foundingCapacity: 100,
      priceMode: 'FIXED',
      priceMinor: 9900,
    })
  })

  it('rejects founding offers without a fixed price or positive capacity before persistence', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planAuditRequest({
      ...planAuditInput,
      offerKind: 'FOUNDING',
      foundingCapacity: 0,
    }), auditStoreTestEnv(db))
    expect(response.status).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects noncanonical plan commercial terms before any audit database access', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(
      planAuditRequest({ ...planAuditInput, priceMinor: -1 }),
      auditStoreTestEnv(db),
    )
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_MEMBERSHIP_PLAN_AUDIT' })
    expect(append).not.toHaveBeenCalled()
  })

  it('replays the same durable audit event without a duplicate write', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const first = await runtime.default.fetch(planAuditRequest(planAuditInput), auditStoreTestEnv(db))
    const replay = await runtime.default.fetch(planAuditRequest(planAuditInput, true, 'req_plan_audit_retry'), auditStoreTestEnv(db))
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ eventId: planAuditInput.eventId, replayed: true })
    expect(rows.size).toBe(1)
  })

  it('rejects a conflicting payload for an existing plan audit identity', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    await runtime.default.fetch(planAuditRequest(planAuditInput), auditStoreTestEnv(db))
    const conflicting = { ...planAuditInput, creatorId: 'creator_002' }
    const response = await runtime.default.fetch(planAuditRequest(conflicting), auditStoreTestEnv(db))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'AUDIT_EVENT_CONFLICT' })
    expect(rows.size).toBe(1)
  })

  it('fails closed when the audit database does not confirm persistence', async () => {
    const { db } = createPlanAuditDb(false)
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planAuditRequest(planAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' })
  })



  it('requires the private W01 transport and creator-capable layer for publish intent audit', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const noTransport = await runtime.default.fetch(planPublishRequestAuditRequest(publishRequestAuditInput, false), auditStoreTestEnv(db))
    expect(noTransport.status).toBe(403)
    expect(append).not.toHaveBeenCalled()

    const tooLow = await runtime.default.fetch(
      planPublishRequestAuditRequest(publishRequestAuditInput, true, 'req_plan_publish_intent_l2', 'L2'),
      auditStoreTestEnv(db),
    )
    expect(tooLow.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

  it('persists publish intent before lifecycle mutation using W01-derived actor and a stable request identity', async () => {
    const { db, append, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planPublishRequestAuditRequest(publishRequestAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      eventId: publishRequestAuditInput.eventId,
      action: 'membership.plan.publish_requested',
      targetType: 'MembershipPlan',
      targetId: planId,
      replayed: false,
    })
    expect(append).toHaveBeenCalledTimes(1)
    const row = rows.get(publishRequestAuditInput.eventId)
    expect(row).toMatchObject({
      actor: { actorId: 'creator_user_001', actorType: 'user', layer: 'L3' },
      action: 'membership.plan.publish_requested',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: { creatorId: 'creator_001', expectedVersion: 1 },
      after: {
        creatorId: 'creator_001',
        expectedVersion: 1,
        requestedStatus: 'ACTIVE',
        requestedVisibility: 'PUBLIC',
      },
    })
    expect(typeof row?.occurredAt).toBe('string')
    expect(Number.isNaN(Date.parse(String(row?.occurredAt)))).toBe(false)
  })

  it('confirms an exact semantic intent replay despite a new request timestamp and rejects conflicting facts', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const first = await runtime.default.fetch(planPublishRequestAuditRequest(publishRequestAuditInput), auditStoreTestEnv(db))
    const replay = await runtime.default.fetch(
      planPublishRequestAuditRequest(publishRequestAuditInput, true, 'req_plan_publish_intent_retry'),
      auditStoreTestEnv(db),
    )
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ eventId: publishRequestAuditInput.eventId, replayed: true })
    const conflict = await runtime.default.fetch(
      planPublishRequestAuditRequest({ ...publishRequestAuditInput, creatorId: 'creator_002' }),
      auditStoreTestEnv(db),
    )
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'AUDIT_EVENT_CONFLICT' })
    expect(rows.size).toBe(1)
  })

  it('rejects malformed publish intent facts before D1-03 access', async () => {
    const cases = [
      { ...publishRequestAuditInput, expectedVersion: 0 },
      { ...publishRequestAuditInput, requestedStatus: 'DRAFT' },
      { ...publishRequestAuditInput, eventId: 'evt_mpl_publish_requested_' + planId + '_v2' },
      { ...publishRequestAuditInput, actorId: 'spoofed-actor' },
    ]
    for (const input of cases) {
      const { db, append } = createPlanAuditDb()
      const runtime = await import('./index')
      const response = await runtime.default.fetch(planPublishRequestAuditRequest(input), auditStoreTestEnv(db))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'INVALID_MEMBERSHIP_PLAN_PUBLISH_REQUEST_AUDIT' })
      expect(append).not.toHaveBeenCalled()
    }
  })

  it('requires the private W01 transport and creator-capable layer for plan publish audits', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const noTransport = await runtime.default.fetch(planPublishAuditRequest(publishAuditInput, false), auditStoreTestEnv(db))
    expect(noTransport.status).toBe(403)
    expect(append).not.toHaveBeenCalled()

    const tooLow = await runtime.default.fetch(
      planPublishAuditRequest(publishAuditInput, true, 'req_plan_publish_l2', 'L2'),
      auditStoreTestEnv(db),
    )
    expect(tooLow.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })


  it('durably records membership plan update intent and idempotently confirms semantic retries', async () => {
    const { db, append, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const first = await runtime.default.fetch(planUpdateRequestAuditRequest(planUpdateRequestAuditInput), auditStoreTestEnv(db))
    const replay = await runtime.default.fetch(
      planUpdateRequestAuditRequest(planUpdateRequestAuditInput, true, 'req_plan_update_intent_retry'),
      auditStoreTestEnv(db),
    )
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({
      eventId: planUpdateRequestAuditInput.eventId,
      action: 'membership.plan.update_requested',
      targetId: planId,
      replayed: true,
    })
    const conflict = await runtime.default.fetch(
      planUpdateRequestAuditRequest({ ...planUpdateRequestAuditInput, priceMinor: 999 }),
      auditStoreTestEnv(db),
    )
    expect(conflict.status).toBe(409)
    expect(rows.size).toBe(1)
    expect(append).toHaveBeenCalled()
  })

  it('rejects malformed update-intent facts and missing private transport before D1-03 access', async () => {
    const malformed = { ...planUpdateRequestAuditInput, priceMinor: -1 }
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const bad = await runtime.default.fetch(planUpdateRequestAuditRequest(malformed), auditStoreTestEnv(db))
    const noTransport = await runtime.default.fetch(planUpdateRequestAuditRequest(planUpdateRequestAuditInput, false), auditStoreTestEnv(db))
    expect(bad.status).toBe(400)
    expect(noTransport.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

  it('durably records lifecycle intent and rejects conflicting semantic replay', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const first = await runtime.default.fetch(planLifecycleRequestAuditRequest(planLifecycleRequestAuditInput), auditStoreTestEnv(db))
    const replay = await runtime.default.fetch(planLifecycleRequestAuditRequest(planLifecycleRequestAuditInput, true, 'req_plan_lifecycle_retry'), auditStoreTestEnv(db))
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ eventId: planLifecycleRequestAuditInput.eventId, action: 'membership.plan.lifecycle_requested', replayed: true })
    const conflict = await runtime.default.fetch(
      planLifecycleRequestAuditRequest({ ...planLifecycleRequestAuditInput, creatorId: 'creator_002' }), auditStoreTestEnv(db),
    )
    expect(conflict.status).toBe(409)
    expect(rows.size).toBe(1)
  })

  it('rejects malformed lifecycle intent and requires private W01 transport', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const malformed = await runtime.default.fetch(
      planLifecycleRequestAuditRequest({ ...planLifecycleRequestAuditInput, requestedStatus: 'ACTIVE' }), auditStoreTestEnv(db),
    )
    const noTransport = await runtime.default.fetch(planLifecycleRequestAuditRequest(planLifecycleRequestAuditInput, false), auditStoreTestEnv(db))
    expect(malformed.status).toBe(400)
    expect(noTransport.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

  it('persists an immutable plan pause event with before and after state', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planLifecycleAuditRequest(planLifecycleAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ eventId: planLifecycleAuditInput.eventId, action: 'membership.plan.paused', targetId: planId, replayed: false })
    expect(rows.get(planLifecycleAuditInput.eventId)).toMatchObject({
      action: 'membership.plan.paused', targetType: 'MembershipPlan', targetId: planId,
      before: { creatorId: 'creator_001', planVersion: 2, status: 'ACTIVE', visibility: 'PUBLIC', version: 2 },
      after: { creatorId: 'creator_001', planVersion: 2, status: 'PAUSED', visibility: 'PRIVATE', version: 3 },
    })
  })

  it('persists a permanent plan retirement audit from PAUSED/PRIVATE to RETIRED/PRIVATE', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planLifecycleAuditRequest(planLifecycleRetireAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      eventId: planLifecycleRetireAuditInput.eventId,
      action: 'membership.plan.retired',
      targetType: 'MembershipPlan',
      targetId: planId,
      replayed: false,
    })
    expect(rows.get(planLifecycleRetireAuditInput.eventId)).toMatchObject({
      action: 'membership.plan.retired',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: { creatorId: 'creator_001', planVersion: 2, status: 'PAUSED', visibility: 'PRIVATE', version: 3 },
      after: { creatorId: 'creator_001', planVersion: 2, status: 'RETIRED', visibility: 'PRIVATE', version: 4 },
    })
  })

  it('persists membership plan updated event with exact version and new commercial terms', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planUpdatedAuditRequest(planUpdatedAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      eventId: planUpdatedAuditInput.eventId,
      action: 'membership.plan.updated',
      targetId: planId,
      replayed: false,
    })
    expect(rows.get(planUpdatedAuditInput.eventId)).toMatchObject({
      action: 'membership.plan.updated',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: { creatorId: 'creator_001', expectedVersion: 2, planVersion: 1 },
      after: {
        creatorId: 'creator_001', expectedVersion: 2, planVersion: 2, version: 3,
        status: 'ACTIVE', visibility: 'PUBLIC', ...updateAuditTerms,
      },
    })
  })

  it('persists membership plan publication with immutable before/after lifecycle facts', async () => {
    const { db, append, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(planPublishAuditRequest(publishAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      eventId: publishAuditInput.eventId,
      action: 'membership.plan.published',
      targetType: 'MembershipPlan',
      targetId: planId,
      replayed: false,
    })
    expect(append).toHaveBeenCalledTimes(1)
    expect(rows.get(publishAuditInput.eventId)).toMatchObject({
      actor: { actorId: 'creator_user_001', actorType: 'user', layer: 'L3' },
      action: 'membership.plan.published',
      targetType: 'MembershipPlan',
      targetId: planId,
      before: {
        creatorId: 'creator_001',
        planVersion: 1,
        status: 'DRAFT',
        visibility: 'PRIVATE',
        version: 1,
      },
      after: {
        creatorId: 'creator_001',
        planVersion: 1,
        status: 'ACTIVE',
        visibility: 'PUBLIC',
        version: 2,
        name: 'Supporter',
        tier: 'supporter',
        billingInterval: 'MONTHLY',
        priceMode: 'FIXED',
        priceMinor: 500,
        minimumPriceMinor: null,
        suggestedPriceMinor: null,
        maximumPriceMinor: null,
        offerKind: 'STANDARD',
        foundingCapacity: null,
        currency: 'USD',
      },
      occurredAt: publishAuditInput.occurredAt,
    })
  })

  it('replays an identical plan publication audit and rejects conflicting immutable facts', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const first = await runtime.default.fetch(planPublishAuditRequest(publishAuditInput), auditStoreTestEnv(db))
    const replay = await runtime.default.fetch(
      planPublishAuditRequest(publishAuditInput, true, 'req_plan_publish_audit_retry'),
      auditStoreTestEnv(db),
    )
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ eventId: publishAuditInput.eventId, replayed: true })
    const conflict = await runtime.default.fetch(
      planPublishAuditRequest({ ...publishAuditInput, priceMinor: 900 }),
      auditStoreTestEnv(db),
    )
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'AUDIT_EVENT_CONFLICT' })
    expect(rows.size).toBe(1)
  })

  it('rejects malformed publication version/status and spoofed fields before D1-03 access', async () => {
    const cases = [
      { ...publishAuditInput, version: 1 },
      { ...publishAuditInput, status: 'DRAFT' },
      { ...publishAuditInput, eventId: 'evt_mpl_published_' + planId + '_v3' },
      { ...publishAuditInput, actorId: 'spoofed-actor' },
    ]
    for (const input of cases) {
      const { db, append } = createPlanAuditDb()
      const runtime = await import('./index')
      const response = await runtime.default.fetch(planPublishAuditRequest(input), auditStoreTestEnv(db))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'INVALID_MEMBERSHIP_PLAN_PUBLISH_AUDIT' })
      expect(append).not.toHaveBeenCalled()
    }
  })

  it('requires the private W01 transport for commerce order audit writes', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(orderAuditRequest(orderAuditInput, false), auditStoreTestEnv(db))
    expect(response.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects L1 order audit writes before touching D1-03', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(
      orderAuditRequest(orderAuditInput, true, 'req_order_audit_l1', 'L1'),
      auditStoreTestEnv(db),
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'PERMISSION_DENIED' })
    expect(append).not.toHaveBeenCalled()
  })

  it('persists commerce order facts using the W01-derived actor and immutable audit identity', async () => {
    const { db, append, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const response = await runtime.default.fetch(orderAuditRequest(orderAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({
      eventId: orderAuditInput.eventId,
      action: 'commerce.order.created',
      targetType: 'Order',
      targetId: orderId,
      replayed: false,
    })
    expect(append).toHaveBeenCalledTimes(1)
    expect(rows.get(orderAuditInput.eventId)).toMatchObject({
      actor: { actorId: 'buyer_user_001', actorType: 'user', layer: 'L2' },
      action: 'commerce.order.created',
      targetType: 'Order',
      targetId: orderId,
      before: {},
      after: {
        status: 'CREATED',
        version: 1,
        currency: 'USD',
        subtotalMinor: 1200,
        discountMinor: 100,
        taxMinor: 88,
        totalMinor: 1188,
      },
      occurredAt: orderAuditInput.occurredAt,
    })
  })

  it('rejects inconsistent order totals and caller-supplied audit fields before any D1 access', async () => {
    const { db, append } = createPlanAuditDb()
    const runtime = await import('./index')
    const badTotal = await runtime.default.fetch(
      orderAuditRequest({ ...orderAuditInput, totalMinor: 1 }),
      auditStoreTestEnv(db),
    )
    expect(badTotal.status).toBe(400)
    expect(await badTotal.json()).toEqual({ error: 'INVALID_COMMERCE_ORDER_AUDIT' })
    expect(append).not.toHaveBeenCalled()

    const spoofedActor = await runtime.default.fetch(
      orderAuditRequest({ ...orderAuditInput, actorId: 'attacker', userId: 'attacker' }),
      auditStoreTestEnv(db),
    )
    expect(spoofedActor.status).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })

  it('replays an identical commerce order audit and rejects conflicting facts', async () => {
    const { db, rows } = createPlanAuditDb()
    const runtime = await import('./index')
    const first = await runtime.default.fetch(orderAuditRequest(orderAuditInput), auditStoreTestEnv(db))
    const replay = await runtime.default.fetch(
      orderAuditRequest(orderAuditInput, true, 'req_order_audit_retry'),
      auditStoreTestEnv(db),
    )
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ eventId: orderAuditInput.eventId, replayed: true })
    expect(rows.size).toBe(1)

    const conflicting = { ...orderAuditInput, currency: 'EUR' }
    const conflict = await runtime.default.fetch(orderAuditRequest(conflicting), auditStoreTestEnv(db))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({ error: 'AUDIT_EVENT_CONFLICT' })
    expect(rows.size).toBe(1)
  })

  it('fails closed when the commerce order audit write cannot be confirmed', async () => {
    const { db } = createPlanAuditDb(false)
    const runtime = await import('./index')
    const response = await runtime.default.fetch(orderAuditRequest(orderAuditInput), auditStoreTestEnv(db))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' })
  })

  it('persists a canonical AUTH-013 account-state AuditEvent through the native Store', async () => {
    const { db, append, rows } = createDb(true)
    const runtime = await import('./index')
    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(eventInput),
      }),
      auditStoreTestEnv(db),
    )
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      eventId: 'evt-runtime-1',
      action: 'identity.account_state_changed',
      targetType: 'User',
      targetId: 'user-001',
    })
    expect(append).toHaveBeenCalledTimes(1)
    expect(rows.get('evt-runtime-1')).toMatchObject({
      actor: eventInput.actor,
      action: 'identity.account_state_changed',
      targetType: 'User',
      targetId: 'user-001',
      before: { account_state: 'PENDING_VERIFICATION', account_state_version: 1 },
      after: { account_state: 'ACTIVE', account_state_version: 2 },
      reason: 'verification completed',
    })
  })

  it('rejects malformed runtime input without touching persistence', async () => {
    const { db, append } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...eventInput,
          afterVersion: 4,
        }),
      }),
      auditStoreTestEnv(db),
    )

    expect(response.status).toBe(400)
    expect(append).not.toHaveBeenCalled()
  })

  it('rejects non-canonical resource and correlation identifiers', async () => {
    const { db, append } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...eventInput,
          eventId: 'event.invalid',
          requestId: 'request-runtime-1',
        }),
      }),
      auditStoreTestEnv(db),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_AUDIT_EVENT' })
    expect(append).not.toHaveBeenCalled()
  })

  it('fails closed when AuditEvent persistence fails', async () => {
    const { db } = createDb(false)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/account-state-changed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(eventInput),
      }),
      auditStoreTestEnv(db),
    )

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' })
  })

  it('fails closed on moderation case detail when Neon Hyperdrive is missing', async () => {
    const runtime = await import('./index')
    const response = await runtime.default.fetch(
      new Request('https://w06.internal/admin/moderation/cases/case_1', {
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'reviewer_1',
          'X-LuckRead-Principal-Layer': 'L6',
          'X-LuckRead-Correlation-Id': 'case-detail-correlation',
          'X-LuckRead-Request-Id': 'req_case_detail_missing_hyperdrive',
          'X-LuckRead-Authz-Decision': 'ALLOW',
          'X-LuckRead-Authz-Permission': 'moderation.case.read',
          'X-LuckRead-Authz-Resource-Type': 'ModerationCase',
          'X-LuckRead-Authz-Policy-Version': 'casl-l0-l8-v1',
          'X-LuckRead-Authz-Subject-Id': 'reviewer_1',
          'X-LuckRead-Authz-Layer': 'L6',
        },
      }),
      {} as never,
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } })
  })

  it('keeps the health response explicit about persistence support', async () => {
    const { db } = createDb(true)
    const runtime = await import('./index')

    const response = await runtime.default.fetch(
      new Request('https://w06.internal/health'),
      auditStoreTestEnv(db),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      service: 'W06',
      status: 'ok',
      auditPersistence: 'enabled',
      moderationRuntime: 'enabled',
    })
  })

  it('persists a token-free push endpoint mutation intent using the authenticated W01 actor', async () => {
    const db = { connectionString: 'postgresql://test.local/luckread_governance' }
    const { append, rows } = registerAuditEventStoreTestDouble(db)
    const runtime = await import('./index')
    const eventId = 'evt_push_endpoint_' + 'a'.repeat(64)
    const idempotencyKey = 'idem_push_register_0001'
    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/push-endpoint-mutation-requested', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'push_owner_001',
          'X-LuckRead-Principal-Layer': 'L2',
          'X-LuckRead-Correlation-Id': 'push-audit-correlation',
          'X-LuckRead-Request-Id': 'req_push_audit_001',
        },
        body: JSON.stringify({
          eventId,
          installationId: '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c',
          operation: 'REGISTER',
          idempotencyKey,
          platform: 'android',
          permissionStatus: 'granted',
        }),
      }),
      auditStoreTestEnv(db),
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      eventId,
      action: 'notification.push_endpoint.mutation_requested',
      targetType: 'NotificationPushEndpoint',
      targetId: '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c',
      replayed: false,
    })
    expect(append).toHaveBeenCalledTimes(1)
    const event = rows.get(eventId)
    expect(event).toMatchObject({
      actor: { actorId: 'push_owner_001', actorType: 'user', layer: 'L2' },
      action: 'notification.push_endpoint.mutation_requested',
      targetType: 'NotificationPushEndpoint',
      targetId: '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c',
      after: { operation: 'REGISTER', provider: 'expo', platform: 'android', permissionStatus: 'granted' },
    })
    expect(JSON.stringify(event)).not.toContain('ExponentPushToken')
  })

  it('rejects an idempotency mismatch and L1 audit attempt before AuditEvent Store access', async () => {
    const db = { connectionString: 'postgresql://test.local/luckread_governance' }
    const { append } = registerAuditEventStoreTestDouble(db)
    const runtime = await import('./index')
    const body = {
      eventId: 'evt_push_endpoint_' + 'b'.repeat(64),
      installationId: '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c',
      operation: 'REMOVE',
      idempotencyKey: 'idem_push_remove_0001',
      platform: null,
      permissionStatus: null,
    }
    const headers = {
      'content-type': 'application/json',
      'Idempotency-Key': 'idem_push_remove_other',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': 'push_owner_001',
      'X-LuckRead-Principal-Layer': 'L2',
      'X-LuckRead-Correlation-Id': 'push-audit-correlation',
      'X-LuckRead-Request-Id': 'req_push_audit_002',
    }
    const mismatch = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/push-endpoint-mutation-requested', {
        method: 'POST', headers, body: JSON.stringify(body),
      }),
      auditStoreTestEnv(db),
    )
    expect(mismatch.status).toBe(409)
    expect(append).not.toHaveBeenCalled()

    const lowLayer = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/push-endpoint-mutation-requested', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': body.idempotencyKey, 'X-LuckRead-Principal-Layer': 'L1' },
        body: JSON.stringify(body),
      }),
      auditStoreTestEnv(db),
    )
    expect(lowLayer.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

  it('persists a notification-preferences mutation intent with the authenticated W01 actor', async () => {
    const db = { connectionString: 'postgresql://test.local/luckread_governance' }
    const { append, rows } = registerAuditEventStoreTestDouble(db)
    const runtime = await import('./index')
    const eventId = 'evt_notification_preferences_123e4567-e89b-42d3-a456-426614174000'
    const response = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/notification-preferences-update-requested', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
          'X-LuckRead-Principal-User-Id': 'preferences-owner-001',
          'X-LuckRead-Principal-Layer': 'L2',
          'X-LuckRead-Correlation-Id': 'preferences-audit-correlation',
          'X-LuckRead-Request-Id': 'req_preferences_audit_001',
        },
        body: JSON.stringify({ eventId, preferences: { follow: false, mention: true } }),
      }),
      auditStoreTestEnv(db),
    )
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      eventId, action: 'notification.preferences.update_requested',
      targetType: 'Notification', targetId: 'preferences-owner-001', replayed: false,
    })
    expect(append).toHaveBeenCalledTimes(1)
    expect(rows.get(eventId)).toMatchObject({
      actor: { actorId: 'preferences-owner-001', actorType: 'user', layer: 'L2' },
      action: 'notification.preferences.update_requested',
      targetType: 'Notification',
      targetId: 'preferences-owner-001',
      after: { preferences: { follow: false, mention: true } },
    })
  })

  it('rejects spoofed owner fields and an L1 audit before AuditEvent Store access', async () => {
    const db = { connectionString: 'postgresql://test.local/luckread_governance' }
    const { append } = registerAuditEventStoreTestDouble(db)
    const runtime = await import('./index')
    const eventId = 'evt_notification_preferences_123e4567-e89b-42d3-a456-426614174001'
    const headers = {
      'X-LuckRead-Caller': 'W01', 'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': 'preferences-owner-001', 'X-LuckRead-Principal-Layer': 'L2',
      'X-LuckRead-Correlation-Id': 'preferences-audit-correlation', 'X-LuckRead-Request-Id': 'req_preferences_audit_002',
    }
    const spoofed = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/notification-preferences-update-requested', {
        method: 'POST', headers,
        body: JSON.stringify({ eventId, preferences: { follow: false }, userId: 'attacker' }),
      }),
      auditStoreTestEnv(db),
    )
    expect(spoofed.status).toBe(400)
    const lowLayer = await runtime.default.fetch(
      new Request('https://w06.internal/internal/audit-events/notification-preferences-update-requested', {
        method: 'POST', headers: { ...headers, 'X-LuckRead-Principal-Layer': 'L1' },
        body: JSON.stringify({ eventId, preferences: { follow: false } }),
      }),
      auditStoreTestEnv(db),
    )
    expect(lowLayer.status).toBe(403)
    expect(append).not.toHaveBeenCalled()
  })

})

export type RuntimeAuditEvent = AuditEvent
