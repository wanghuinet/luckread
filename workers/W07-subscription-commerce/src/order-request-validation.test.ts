import { describe, expect, it } from 'vitest'
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
    expect(validateOrderCreateIdempotencyKey('x'.repeat(255))).toEqual({ ok: true, value: 'x'.repeat(255) })
    expect(validateOrderCreateIdempotencyKey('x'.repeat(256))).toEqual({
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
