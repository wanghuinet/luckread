import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MAX_ORDER_ITEMS,
  MAX_ORDER_QUANTITY,
  validateCreateCommerceOrderRequest,
  validateOrderCreateIdempotencyKey,
} from './order-request-validation.js'

describe('Commerce Order candidate DTO validation', () => {
  it('accepts a bounded item-reference/quantity request and returns a defensive canonical value', () => {
    const request = { items: [{ itemRef: 'content_123', quantity: 2 }] }
    const result = validateCreateCommerceOrderRequest(request)
    expect(result).toEqual({ ok: true, value: { items: [{ itemRef: 'content_123', quantity: 2 }] } })
    if (result.ok) {
      expect(result.value.items).not.toBe(request.items)
      expect(result.value.items[0]).not.toBe(request.items[0])
    }
  })

  it('rejects non-object bodies, arrays, null, and unexpected top-level properties', () => {
    for (const value of [null, [], 'bad', 12, { items: [], customerId: 'user_victim' }, { items: [], totalMinor: 1 }]) {
      expect(validateCreateCommerceOrderRequest(value).ok).toBe(false)
    }
  })

  it('does not allow the client to assert prices, currency, payment state, or item metadata', () => {
    const invalidItems = [
      { itemRef: 'content_123', quantity: 1, unitAmountMinor: 1 },
      { itemRef: 'content_123', quantity: 1, itemType: 'CONTENT' },
      { itemRef: 'content_123', quantity: 1, itemVersion: 'v999' },
      { itemRef: 'content_123', quantity: 1, currency: 'USD' },
      { itemRef: 'content_123', quantity: 1, paid: true },
      { itemRef: 'content_123', quantity: 1, customerId: 'user_victim' },
    ]
    for (const item of invalidItems) {
      expect(validateCreateCommerceOrderRequest({ items: [item] })).toEqual({
        ok: false,
        error: { code: 'VALIDATION_FAILED', status: 400, field: 'items[0]' },
      })
    }
  })

  it('requires between one and the bounded maximum number of lines', () => {
    expect(validateCreateCommerceOrderRequest({ items: [] }).ok).toBe(false)
    expect(validateCreateCommerceOrderRequest({ items: Array.from({ length: MAX_ORDER_ITEMS + 1 }, (_, i) => ({ itemRef: `item_${i}`, quantity: 1 })) }).ok).toBe(false)
    expect(validateCreateCommerceOrderRequest({ items: Array.from({ length: MAX_ORDER_ITEMS }, (_, i) => ({ itemRef: `item_${i}`, quantity: 1 })) }).ok).toBe(true)
  })

  it('rejects duplicate item references so pricing and line aggregation cannot be ambiguous', () => {
    expect(validateCreateCommerceOrderRequest({ items: [{ itemRef: 'item_1', quantity: 1 }, { itemRef: 'item_1', quantity: 2 }] })).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', status: 400, field: 'items[1].itemRef' },
    })
  })

  it('rejects blank, padded, overlong, or control-character item references', () => {
    for (const itemRef of ['', '   ', ' item_1', 'item_1 ', 'item\n1', 'x'.repeat(256)]) {
      expect(validateCreateCommerceOrderRequest({ items: [{ itemRef, quantity: 1 }] }).ok).toBe(false)
    }
    expect(validateCreateCommerceOrderRequest({ items: [{ itemRef: 'x'.repeat(255), quantity: 1 }] }).ok).toBe(true)
  })

  it('requires a positive safe integer quantity no greater than the candidate contract limit', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, MAX_ORDER_QUANTITY + 1, '2', null]) {
      expect(validateCreateCommerceOrderRequest({ items: [{ itemRef: 'item_1', quantity }] }).ok).toBe(false)
    }
    expect(validateCreateCommerceOrderRequest({ items: [{ itemRef: 'item_1', quantity: 1 }] }).ok).toBe(true)
    expect(validateCreateCommerceOrderRequest({ items: [{ itemRef: 'item_1', quantity: MAX_ORDER_QUANTITY }] }).ok).toBe(true)
  })
})

describe('Commerce Order Idempotency-Key candidate header', () => {
  it('fails before side effects when the key is missing or blank', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(validateOrderCreateIdempotencyKey(value)).toEqual({
        ok: false,
        error: { code: 'PRECONDITION_REQUIRED', status: 428, field: 'Idempotency-Key' },
      })
    }
  })

  it('trims surrounding whitespace and keeps the normalized key bounded', () => {
    expect(validateOrderCreateIdempotencyKey('  idem-123  ')).toEqual({ ok: true, value: 'idem-123' })
    expect(validateOrderCreateIdempotencyKey('x'.repeat(256))).toEqual({ ok: true, value: 'x'.repeat(256) })
    expect(validateOrderCreateIdempotencyKey('x'.repeat(257))).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', status: 400, field: 'Idempotency-Key' },
    })
  })

  it('rejects embedded control characters in the idempotency key', () => {
    expect(validateOrderCreateIdempotencyKey('idem\nkey')).toEqual({
      ok: false,
      error: { code: 'VALIDATION_FAILED', status: 400, field: 'Idempotency-Key' },
    })
  })
})


describe('PAY-002 API contract admission boundary', () => {
  it('admits canonical API, permission and role contracts while keeping runtime blocked', () => {
    const candidate = JSON.parse(readFileSync(new URL('../../../contracts/candidates/PAY-002/order-commerce-api.v1.json', import.meta.url), 'utf8'))
    const gate = JSON.parse(readFileSync(new URL('../../../contracts/candidates/PAY-002/order-api-admission.v1.json', import.meta.url), 'utf8'))
    const openapi = readFileSync(new URL('../../../contracts/openapi/v1/openapi.yaml', import.meta.url), 'utf8')
    const permissions = JSON.parse(readFileSync(new URL('../../../contracts/authz/permissions.json', import.meta.url), 'utf8'))
    const policy = JSON.parse(readFileSync(new URL('../../../contracts/openapi/v1/operation-policy.json', import.meta.url), 'utf8'))
    const inventory = JSON.parse(readFileSync(new URL('../../../contracts/api/api-inventory.v1.json', import.meta.url), 'utf8'))

    expect(candidate.status).toBe('CONTRACT_ADMITTED_RUNTIME_PENDING')
    expect(candidate.operations.map((operation: { operationId: string }) => operation.operationId)).toEqual(['createCommerceOrder', 'getCommerceOrder'])
    expect(candidate.operations.every((operation: { candidateStatus: string }) => operation.candidateStatus === 'CONTRACTED_PENDING_RUNTIME')).toBe(true)
    expect(candidate.dtoSchemas.CommerceOrderResponse.required).toEqual(['data', 'requestId'])
    expect(gate.status).toBe('BLOCKED_ON_RUNTIME_PERSISTENCE_AND_SECURITY_EVIDENCE')
    expect(gate.requiredEvidence.filter((item: { id: string }) => ['API-OPENAPI-01', 'AUTH-PERMISSION-01'].includes(item.id)).every((item: { status: string }) => item.status === 'ADMITTED')).toBe(true)
    expect(gate.requiredEvidence.filter((item: { status: string }) => item.status === 'PENDING').length).toBeGreaterThan(0)

    expect(openapi).toContain('/commerce/orders:')
    expect(openapi).toContain('/commerce/orders/{orderId}:')
    expect(openapi).toContain('operationId: createCommerceOrder')
    expect(openapi).toContain('operationId: getCommerceOrder')
    expect(openapi).toContain('x-luckread-runtime-status: BLOCKED_PENDING_PAY002_EVIDENCE')
    expect(openapi).toContain('x-luckread-max-body-bytes: 16384')

    const registeredPermissions = new Map((permissions['x-permissions'] ?? []).map((p: { name: string; scope?: string; minLayer: string }) => [p.name, p]))
    for (const name of ['order.create', 'order.read']) {
      expect(registeredPermissions.has(name)).toBe(true)
      expect((registeredPermissions.get(name) as { scope?: string; minLayer: string }).scope).toBe('own')
      expect((registeredPermissions.get(name) as { scope?: string; minLayer: string }).minLayer).toBe('L2')
    }
    const roles = permissions['x-role-permissions'].roles
    for (const roleName of ['verified_user', 'admin', 'super_admin']) {
      const role = roles.find((r: { role: string }) => r.role === roleName)
      expect(role.permissions).toContain('order.create')
      expect(role.permissions).toContain('order.read')
    }
    const byId = new Map(policy.operations.map((op: { operationId: string }) => [op.operationId, op]))
    expect((byId.get('createCommerceOrder') as any).permissions).toEqual(['order.create'])
    expect((byId.get('createCommerceOrder') as any).idempotencyRequired).toBe(true)
    expect((byId.get('getCommerceOrder') as any).permissions).toEqual(['order.read'])
    const inventoryPaths = inventory.domains.subscription_entitlement_payment.endpoint_groups
    expect(inventoryPaths).toContain('POST /v1/commerce/orders')
    expect(inventoryPaths).toContain('GET /v1/commerce/orders/{orderId}')
  })
})
