import { describe, expect, it } from 'vitest'
import { readBoundedOrderBody } from '../../src/commerce/w07-commerce-client.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const apiInventory = JSON.parse(read('../../contracts/api/api-inventory.v1.json'))
const w07Binding = JSON.parse(read('../../contracts/transport/W01-W07-membership-commerce-http-binding.v1.json'))
const w06Binding = JSON.parse(read('../../contracts/transport/W01-W06-moderation-http-binding.v1.json'))
const createRoute = read('src/app/api/v1/commerce/orders/route.ts')
const getRoute = read('src/app/api/v1/commerce/orders/[orderId]/route.ts')
const client = read('src/commerce/w07-commerce-client.ts')
const w06Client = read('src/moderation/w06-moderation-client.ts')
const w06Runtime = read('../W06-governance/src/index.ts')
const w07OrderRuntime = read('../W07-subscription-commerce/src/order-http-runtime.ts')
const wrangler = read('wrangler.jsonc')

describe('v1 commerce order adapter', () => {
  it('accepts a valid decimal Content-Length for a bounded JSON order request', async () => {
    const body = JSON.stringify({ items: [{ itemRef: 'plan_' + 'a'.repeat(64), quantity: 1 }] })
    const request = new Request('https://luckread.example/api/v1/commerce/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(new TextEncoder().encode(body).byteLength),
      },
      body,
    })

    const parsed = await readBoundedOrderBody(request)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value).toEqual(JSON.parse(body))
  })

  it('rejects malformed or over-limit declared Content-Length before parsing the body', async () => {
    const makeRequest = (contentLength: string) => new Request('https://luckread.example/api/v1/commerce/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': contentLength },
      body: JSON.stringify({ items: [] }),
    })

    const malformed = await readBoundedOrderBody(makeRequest('12x'))
    expect(malformed.ok).toBe(false)
    if (malformed.ok === false) expect(malformed.response.status).toBe(400)

    const oversized = await readBoundedOrderBody(makeRequest('16385'))
    expect(oversized.ok).toBe(false)
    if (oversized.ok === false) expect(oversized.response.status).toBe(400)
  })

  it('authorizes order creation using the W02-backed W08 CASL decision before calling W07', () => {
    expect(createRoute).toContain("authorizeOrderPermission(request, principal, 'order.create')")
    expect(client).toContain("resourceType: 'Order'")
    expect(client).toContain("resourceAttributes: { ownerId: principal.userId }")
    expect(client).toContain("callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST')")
    expect(createRoute).toContain("pathname: '/commerce/orders'")
    expect(createRoute).toContain("method: 'POST'")
    expect(createRoute.indexOf("const denied = await authorizeOrderPermission(request, principal, 'order.create')")).toBeLessThan(createRoute.indexOf('const w07Response = await callW07Subscription'))
  })

  it('bounds order requests and rejects missing or malformed idempotency keys before forwarding', () => {
    expect(client).toContain('const maxBytes = 16_384')
    expect(client).toContain("application\\/json")
    expect(client).toContain('request.body.getReader()')
    expect(createRoute).toContain("validateOrderIdempotencyKey(request.headers.get('Idempotency-Key'))")
    expect(client).toContain('key.length > 256')
    expect(client).toContain('Idempotency-Key is required')
  })

  it('reads only the authenticated customer order through W07 owner-scoped persistence', () => {
    expect(getRoute).toContain("authorizeOrderPermission(request, principal, 'order.read')")
    expect(getRoute).toContain("pathname: '/commerce/orders/' + encodeURIComponent(orderId)")
    expect(w07OrderRuntime).toContain('getOrder(env.D1_04, customerId, route.orderId)')
    expect(getRoute).toContain("method: 'GET'")
  })

  it('validates all order totals and line equations before creating the W06 audit fact', () => {
    expect(client).toContain('validateCreatedCommerceOrderEnvelope')
    expect(client).toContain('expectedSubtotal')
    expect(client).toContain('expectedTotal')
    expect(client).toContain('subtotal !== order.subtotalMinor')
    expect(client).toContain('order.discountMinor > order.subtotalMinor')
    expect(createRoute.indexOf('const order = validateCreatedCommerceOrderEnvelope')).toBeLessThan(createRoute.lastIndexOf('callW06CommerceOrderAudit({'))
  })

  it('never returns a successful order response until W06 confirms the durable immutable audit', () => {
    expect(createRoute).toContain('callW06CommerceOrderAudit')
    expect(createRoute).toContain("action?: unknown }).action !== 'commerce.order.created'")
    expect(createRoute).toContain("targetType?: unknown }).targetType !== 'Order'")
    expect(createRoute).toContain('Order audit was not durably confirmed')
    expect(createRoute.indexOf('const w07Response = await callW07Subscription')).toBeLessThan(createRoute.lastIndexOf('callW06CommerceOrderAudit({'))
    expect(createRoute.lastIndexOf('callW06CommerceOrderAudit({')).toBeLessThan(createRoute.lastIndexOf('return w07Response'))
    expect(w06Client).toContain("'/internal/audit-events/commerce-order-created'")
    expect(w06Runtime).toContain("action: 'commerce.order.created'")
    expect(w06Runtime).toContain('persistImmutableAuditEvent(env, event)')
    expect(w06Runtime).toContain('AUDIT_EVENT_CONFLICT')
    expect(w06Runtime).toContain('AUDIT_EVENT_PERSISTENCE_FAILED')
  })

  it('keeps order writes fail-closed while authoritative discount/tax pricing is not admitted', () => {
    expect(w07OrderRuntime).toContain('if (!dependencies.resolvePricing)')
    expect(w07OrderRuntime).toContain('Order creation is disabled until the authoritative pricing and tax decision is admitted')
    expect(w07Binding.operations.find((x: { operationId: string }) => x.operationId === 'createCommerceOrder')?.successRule)
      .toContain('must return 503 without order writes')
    expect(wrangler).toContain('"binding": "W07_SUBSCRIPTION"')
    expect(wrangler).not.toContain('"binding": "D1_04"')
  })

  it('aligns the existing API inventory and existing W01-to-W07/W06 bindings without adding infrastructure', () => {
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('POST /v1/commerce/orders')
    expect(apiInventory.domains.subscription_entitlement_payment.endpoint_groups).toContain('GET /v1/commerce/orders/{orderId}')
    expect(w07Binding.operations.map((x: { operationId: string }) => x.operationId)).toContain('createCommerceOrder')
    expect(w07Binding.operations.map((x: { operationId: string }) => x.operationId)).toContain('getCommerceOrder')
    expect(w06Binding.operations.map((x: { operationId: string }) => x.operationId)).toContain('auditCommerceOrderCreation')
    expect(w07Binding.transport.newWorker).toBe(false)
    expect(w07Binding.transport.newDatabase).toBe(false)
    expect(w07Binding.transport.newBinding).toBe(false)
    expect(w06Binding.topologyConstraints.workerCountDelta).toBe(0)
    expect(w06Binding.topologyConstraints.databaseCountDelta).toBe(0)
  })
})
