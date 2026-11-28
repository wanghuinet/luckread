import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockTrafficLimitError extends Error {}
  class MockW08CreatorClientError extends Error {}
  const cloudflareEnv = {}
  const w08Requests = []
  return {
    w08Requests,
    MockTrafficLimitError,
    MockW08CreatorClientError,
    cloudflareEnv,
    getCloudflareContext: vi.fn(async () => ({ env: cloudflareEnv })),
    principal: { userId: 'user_e2e_owner', layer: 'L2' },
    resolvePrincipal: vi.fn(async () => ({ userId: 'user_e2e_owner', layer: 'L2' })),
    callW08Creator: vi.fn(async (request) => {
      w08Requests.push(await request.clone().json())
      return Response.json({ data: { decision: 'ALLOW' } })
    }),
    enforceWriteRateLimit: vi.fn(async (_request) => undefined),
    enforceWriteAccountRateLimit: vi.fn(async (_accountId) => undefined),
    enforceWriteEndpointRateLimit: vi.fn(async (_endpoint) => undefined),
  }
})

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: mocks.MockTrafficLimitError,
  enforceW01WriteRateLimit: mocks.enforceWriteRateLimit,
  enforceW01WriteAccountRateLimit: mocks.enforceWriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit: mocks.enforceWriteEndpointRateLimit,
  rateLimitResponse: vi.fn((request) => Response.json(
    { error: { code: 'RATE_LIMITED', details: { retryAfter: 60 } } },
    { status: 429, headers: { 'retry-after': '60' } },
  )),
}))

vi.mock('../../src/auth/w08-creator-client.js', () => ({
  callW08Creator: mocks.callW08Creator,
  W08CreatorClientError: mocks.MockW08CreatorClientError,
}))

vi.mock('../../src/subscription/w07-subscription-client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveCookieSubscriptionPrincipal: mocks.resolvePrincipal,
  }
})

import { POST } from '../../src/app/api/v1/commerce/orders/route.js'
import { GET } from '../../src/app/api/v1/commerce/orders/[orderId]/route.js'
import { handleCommerceOrderRequest } from '../../../W07-subscription-commerce/src/order-http-runtime.js'
import { resolveCommerceOrderItems } from '../../../W07-subscription-commerce/src/order-item-resolution.js'
import { OrderPersistenceError } from '../../../W07-subscription-commerce/src/order-persistence.js'

const planA = 'plan_' + 'a'.repeat(64)
const planB = 'plan_' + 'b'.repeat(64)
const unavailablePlan = 'plan_' + 'f'.repeat(64)
const privatePlan = 'plan_' + 'c'.repeat(64)

function membershipPlanRow(planId, priceMinor) {
  const timestamp = '2026-11-28T12:00:00.000Z'
  return {
    plan_id: planId,
    owner_id: 'creator_e2e_01',
    current_version: 2,
    status: 'ACTIVE',
    visibility: 'PUBLIC',
    version: 2,
    created_at: timestamp,
    updated_at: timestamp,
    name: 'E2E Supporter',
    tier: 'supporter',
    billing_interval: 'MONTHLY',
    price_minor: priceMinor,
    currency: 'USD',
    benefits_json: '["Member posts"]',
    trial_period_days: 0,
  }
}

function createHarness() {
  const planRows = new Map([
    [planA, membershipPlanRow(planA, 1200)],
    [planB, membershipPlanRow(planB, 2500)],
    [privatePlan, { ...membershipPlanRow(privatePlan, 1500), visibility: 'PRIVATE' }],
  ])
  const idempotencyRows = new Map()
  const orders = new Map()
  const invoiceOrderIds = new Set()
  const auditEvents = new Map()
  const auditAttempts = []
  const w07Requests = []
  const w06Requests = []
  const state = {
    failNextPersist: false,
    failNextAudit: false,
    pricingCalls: 0,
    persistCalls: 0,
  }

  const pool = {
    async query(_sql, values) {
      const ids = Array.isArray(values?.[0]) ? values[0] : []
      const rows = ids.flatMap((id) => {
        const row = planRows.get(id)
        return row && row.status === 'ACTIVE' && row.visibility === 'PUBLIC' ? [row] : []
      })
      return { rows }
    },
  }

  const store = {
    async readIdempotencyRow(customerId, idempotencyKey) {
      return idempotencyRows.get(customerId + ':' + idempotencyKey) ?? null
    },
    async persistNewOrder(input) {
      state.persistCalls += 1
      const key = input.customerId + ':' + input.idempotencyKey
      const existing = idempotencyRows.get(key)
      if (existing) {
        return {
          statementCount: 0,
          expireChanges: 0,
          claimChanges: 0,
          completionChanges: 0,
          orderChanges: 0,
          lineChanges: [],
        }
      }
      if (state.failNextPersist) {
        state.failNextPersist = false
        throw new Error('simulated PostgreSQL transaction rollback')
      }

      const data = JSON.parse(input.responseJson)
      idempotencyRows.set(key, {
        id: input.idempotencyId,
        customer_id: input.customerId,
        operation_key: input.operationKey,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        state: 'COMPLETED',
        response_status: 201,
        response_json: input.responseJson,
        created_at: input.createdAt,
        expires_at: input.expiresAt,
      })
      orders.set(data.orderId, { customerId: input.customerId, data })
      return {
        statementCount: input.lines.length + 4,
        expireChanges: 0,
        claimChanges: 1,
        completionChanges: 1,
        orderChanges: 1,
        lineChanges: input.lines.map(() => 1),
      }
    },
  }

  const dependencies = {
    getPostgresPool: () => pool,
    getOrderCreateStore: () => store,
    resolvePricing: async (request) => {
      state.pricingCalls += 1
      const resolved = await resolveCommerceOrderItems(pool, request)
      return {
        currency: resolved.currency,
        pricingMode: 'live',
        items: resolved.items.map((item) => ({
          ...item,
          lineDiscountMinor: 0,
          lineTaxMinor: 0,
        })),
      }
    },
    issueInvoice: async (_pool, _customerId, orderId) => {
      // The real invoice writer is separately covered by W07 PostgreSQL tests.
      // This boundary is idempotent on orderId, like the production writer.
      invoiceOrderIds.add(orderId)
      const timestamp = new Date().toISOString()
      return {
        documentId: 'document_' + orderId,
        documentType: 'INVOICE',
        documentNumber: 'INV-' + orderId,
        orderId,
        paymentId: 'payment_' + orderId,
        amountMinor: 1200,
        currency: 'USD',
        snapshot: { orderId },
        issuedAt: timestamp,
        createdAt: timestamp,
      }
    },
    getOrder: async (_pool, customerId, orderId) => {
      const stored = orders.get(orderId)
      if (!stored || stored.customerId !== customerId) {
        throw new OrderPersistenceError('RESOURCE_NOT_FOUND', 404)
      }
      return stored.data
    },
  }

  const w07Service = {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      w07Requests.push(request.clone())
      const caller = request.headers.get('X-LuckRead-Caller')
      const transportVersion = request.headers.get('X-LuckRead-Transport-Version')
      const customerId = request.headers.get('X-LuckRead-Principal-User-Id')
      if (
        caller !== 'W01' ||
        transportVersion !== '1.0' ||
        !customerId ||
        !request.headers.get('X-LuckRead-Principal-Layer') ||
        request.headers.has('cookie') ||
        request.headers.has('authorization')
      ) {
        return Response.json({ error: { code: 'TRANSPORT_REJECTED' } }, { status: 403 })
      }
      return (await handleCommerceOrderRequest(request, customerId, {}, dependencies)) ??
        Response.json({ error: { code: 'ROUTE_NOT_FOUND' } }, { status: 404 })
    },
  }

  const w06Service = {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      w06Requests.push(request.clone())
      const url = new URL(request.url)
      const principalId = request.headers.get('X-LuckRead-Principal-User-Id')
      if (
        url.pathname !== '/internal/audit-events/commerce-order-created' ||
        request.method !== 'POST' ||
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
        !principalId ||
        !request.headers.get('X-LuckRead-Request-Id') ||
        request.headers.has('cookie') ||
        request.headers.has('authorization')
      ) {
        return Response.json({ error: { code: 'TRANSPORT_REJECTED' } }, { status: 403 })
      }

      const body = await request.json()
      auditAttempts.push(body)
      if (state.failNextAudit) {
        state.failNextAudit = false
        return Response.json({ error: { code: 'AUDIT_UNAVAILABLE' } }, { status: 503 })
      }
      const existing = auditEvents.get(body.eventId)
      if (existing && JSON.stringify(existing) !== JSON.stringify(body)) {
        return Response.json({ error: { code: 'IMMUTABLE_FACT_CONFLICT' } }, { status: 409 })
      }
      auditEvents.set(body.eventId, body)
      return Response.json({
        eventId: body.eventId,
        action: 'commerce.order.created',
        targetType: 'Order',
        targetId: body.orderId,
      }, { status: 200 })
    },
  }

  return {
    state,
    store,
    orders,
    invoiceOrderIds,
    auditEvents,
    auditAttempts,
    w07Requests,
    w06Requests,
    w07Service,
    w06Service,
  }
}

function postRequest(body, key) {
  const headers = new Headers({
    'content-type': 'application/json',
    cookie: 'better-auth.session_token=e2e-session',
  })
  if (key !== undefined) headers.set('Idempotency-Key', key)
  return new Request('https://www.luckread.com/api/v1/commerce/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function getRequest(orderId) {
  return new Request('https://www.luckread.com/api/v1/commerce/orders/' + orderId, {
    headers: { cookie: 'better-auth.session_token=e2e-session' },
  })
}

let harness

beforeEach(() => {
  harness = createHarness()
  mocks.cloudflareEnv.W07_SUBSCRIPTION = harness.w07Service
  mocks.cloudflareEnv.W06_MODERATION = harness.w06Service
  mocks.principal = { userId: 'user_e2e_owner', layer: 'L2' }
  mocks.resolvePrincipal.mockReset()
  mocks.resolvePrincipal.mockImplementation(async () => ({ ...mocks.principal }))
  mocks.w08Requests.length = 0
  mocks.callW08Creator.mockReset()
  mocks.callW08Creator.mockImplementation(async (request) => {
    mocks.w08Requests.push(await request.clone().json())
    return Response.json({ data: { decision: 'ALLOW' } })
  })
  mocks.enforceWriteRateLimit.mockReset()
  mocks.enforceWriteRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteAccountRateLimit.mockReset()
  mocks.enforceWriteAccountRateLimit.mockResolvedValue(undefined)
  mocks.enforceWriteEndpointRateLimit.mockReset()
  mocks.enforceWriteEndpointRateLimit.mockResolvedValue(undefined)
})

describe('PAY-002 W01 -> W07 -> W06 create/read security E2E', () => {
  it('creates from server-resolved price, durably audits, and reads only for the owner', async () => {
    const created = await POST(postRequest({ items: [{ itemRef: planA, quantity: 1 }] }, 'e2e_create_001'))
    expect(created.status).toBe(201)
    const createdBody = await created.json()
    const orderId = createdBody.data.orderId

    expect(createdBody.data.totalMinor).toBe(1200)
    expect(createdBody.data.items[0]?.unitAmountMinor).toBe(1200)
    expect(harness.orders.size).toBe(1)
    expect(harness.invoiceOrderIds.size).toBe(1)
    expect(harness.auditEvents.size).toBe(1)
    expect([...harness.auditEvents.values()][0]?.eventId).toBe('evt_order_created_' + orderId)

    expect(harness.w07Requests).toHaveLength(1)
    expect(harness.w07Requests[0]?.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(harness.w07Requests[0]?.headers.get('X-LuckRead-Principal-User-Id')).toBe('user_e2e_owner')
    expect(harness.w07Requests[0]?.headers.has('cookie')).toBe(false)
    expect(harness.w07Requests[0]?.headers.has('authorization')).toBe(false)
    expect(harness.w06Requests[0]?.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(harness.w06Requests[0]?.headers.has('cookie')).toBe(false)
    expect(harness.w06Requests[0]?.headers.has('authorization')).toBe(false)
    expect(mocks.w08Requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'order.create', resourceType: 'Order', resourceAttributes: { ownerId: 'user_e2e_owner' } }),
    ]))

    const ownerRead = await GET(getRequest(orderId), { params: Promise.resolve({ orderId }) })
    expect(ownerRead.status).toBe(200)
    const ownerBody = await ownerRead.json()
    expect(ownerBody.data.orderId).toBe(orderId)
    expect(ownerBody.data.totalMinor).toBe(1200)
    expect(mocks.w08Requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'order.read', resourceType: 'Order', resourceAttributes: { ownerId: 'user_e2e_owner' } }),
    ]))

    mocks.principal = { userId: 'user_e2e_other', layer: 'L2' }
    const otherRead = await GET(getRequest(orderId), { params: Promise.resolve({ orderId }) })
    expect(otherRead.status).toBe(404)
    expect(await otherRead.json()).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND' } })
    expect(mocks.w08Requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'order.read', resourceType: 'Order', resourceAttributes: { ownerId: 'user_e2e_other' } }),
    ]))
  })

  it('rejects malformed JSON, missing keys, unknown fields, price spoofing and unavailable offers before audit/persistence', async () => {
    const malformed = new Request('https://www.luckread.com/api/v1/commerce/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'e2e_malformed_001' },
      body: '{',
    })
    expect((await POST(malformed)).status).toBe(400)

    expect((await POST(postRequest({ items: [{ itemRef: planA, quantity: 1 }] }))).status).toBe(428)

    const unknownField = await POST(postRequest({
      customerId: 'user_e2e_other',
      items: [{ itemRef: planA, quantity: 1 }],
    }, 'e2e_unknown_001'))
    expect(unknownField.status).toBe(400)

    const spoofedPrice = await POST(postRequest({
      items: [{ itemRef: planA, quantity: 1, unitAmountMinor: 1, currency: 'USD' }],
    }, 'e2e_spoof_001'))
    expect(spoofedPrice.status).toBe(400)

    const unavailable = await POST(postRequest({
      items: [{ itemRef: unavailablePlan, quantity: 1 }],
    }, 'e2e_unavailable_001'))
    expect(unavailable.status).toBe(404)

    const privateOffer = await POST(postRequest({
      items: [{ itemRef: privatePlan, quantity: 1 }],
    }, 'e2e_private_001'))
    expect(privateOffer.status).toBe(404)

    expect(harness.orders.size).toBe(0)
    expect(harness.auditEvents.size).toBe(0)
    expect(harness.w06Requests).toHaveLength(0)
    expect(harness.w07Requests).toHaveLength(4)
  })

  it('replays the same semantic request and rejects reuse of its key for a different basket', async () => {
    const first = await POST(postRequest({ items: [{ itemRef: planA, quantity: 1 }] }, 'e2e_replay_001'))
    const replay = await POST(postRequest({ items: [{ itemRef: planA, quantity: 1 }] }, 'e2e_replay_001'))
    const conflict = await POST(postRequest({ items: [{ itemRef: planB, quantity: 1 }] }, 'e2e_replay_001'))

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    const firstBody = await first.json()
    const replayBody = await replay.json()
    expect(replayBody.data.orderId).toBe(firstBody.data.orderId)
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT' },
    })
    expect(harness.orders.size).toBe(1)
    expect(harness.auditEvents.size).toBe(1)
    expect(harness.auditAttempts).toHaveLength(2)
  })

  it('converges concurrent same-key creates to one Order and one immutable audit fact', async () => {
    const body = { items: [{ itemRef: planA, quantity: 1 }] }
    const [left, right] = await Promise.all([
      POST(postRequest(body, 'e2e_concurrent_001')),
      POST(postRequest(body, 'e2e_concurrent_001')),
    ])
    expect(left.status).toBe(201)
    expect(right.status).toBe(201)
    const leftBody = await left.json()
    const rightBody = await right.json()
    expect(leftBody.data.orderId).toBe(rightBody.data.orderId)
    expect(harness.orders.size).toBe(1)
    expect(harness.auditEvents.size).toBe(1)
  })

  it('recovers after a rolled-back create attempt without leaving an idempotency claim', async () => {
    harness.state.failNextPersist = true
    const body = { items: [{ itemRef: planA, quantity: 1 }] }
    const failed = await POST(postRequest(body, 'e2e_recovery_db_001'))
    expect(failed.status).toBe(503)
    expect(harness.orders.size).toBe(0)
    expect(harness.auditEvents.size).toBe(0)

    const recovered = await POST(postRequest(body, 'e2e_recovery_db_001'))
    expect(recovered.status).toBe(201)
    expect(harness.orders.size).toBe(1)
    expect(harness.auditEvents.size).toBe(1)
  })

  it('replays a committed Order after W06 audit outage and succeeds only after durable audit confirmation', async () => {
    harness.state.failNextAudit = true
    const body = { items: [{ itemRef: planA, quantity: 1 }] }
    const first = await POST(postRequest(body, 'e2e_recovery_audit_001'))
    expect(first.status).toBe(503)
    expect(await first.json()).toMatchObject({ error: { code: 'AUDIT_UNAVAILABLE' } })
    expect(harness.orders.size).toBe(1)
    expect(harness.auditEvents.size).toBe(0)

    const retry = await POST(postRequest(body, 'e2e_recovery_audit_001'))
    expect(retry.status).toBe(201)
    expect(harness.orders.size).toBe(1)
    expect(harness.auditEvents.size).toBe(1)
    expect(harness.auditAttempts).toHaveLength(2)
  })
})
