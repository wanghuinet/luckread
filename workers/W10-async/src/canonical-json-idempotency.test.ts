import { webcrypto } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  CanonicalJsonError,
  canonicalizeJsonForIdempotency,
  sha256CanonicalJsonForIdempotency,
} from './canonical-json-idempotency.js'

describe('W10 canonical JSON idempotency fingerprint', () => {
  it('sorts object keys recursively and emits compact JSON', () => {
    const first = { z: 1, nested: { b: 2, a: 3 }, a: ['x', true, null] }
    const second = { a: ['x', true, null], nested: { a: 3, b: 2 }, z: 1 }

    expect(canonicalizeJsonForIdempotency(first, 1024)).toBe(
      '{"a":["x",true,null],"nested":{"a":3,"b":2},"z":1}',
    )
    expect(canonicalizeJsonForIdempotency(first, 1024)).toBe(
      canonicalizeJsonForIdempotency(second, 1024),
    )
  })

  it('produces the same SHA-256 for equivalent payloads and different hashes for different inputs', async () => {
    const first = { orderId: 'ord_123', amountMinor: 1250, currency: 'USD' }
    const equivalent = { currency: 'USD', amountMinor: 1250, orderId: 'ord_123' }
    const changed = { currency: 'USD', amountMinor: 1251, orderId: 'ord_123' }

    const firstHash = await sha256CanonicalJsonForIdempotency(first, 1024, webcrypto.subtle)
    const equivalentHash = await sha256CanonicalJsonForIdempotency(equivalent, 1024, webcrypto.subtle)
    const changedHash = await sha256CanonicalJsonForIdempotency(changed, 1024, webcrypto.subtle)

    expect(firstHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(firstHash).toBe(equivalentHash)
    expect(firstHash).not.toBe(changedHash)
  })

  it('rejects values that JSON.stringify would omit or transform silently', () => {
    const values: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      () => 'not JSON',
      Symbol('not JSON'),
      new Date('2026-10-29T00:00:00.000Z'),
      new Map([['key', 'value']]),
    ]

    for (const value of values) {
      expect(() => canonicalizeJsonForIdempotency(value, 1024)).toThrowError(
        CanonicalJsonError,
      )
    }
  })

  it('rejects cycles, sparse arrays, extra array properties, accessors, and symbol keys', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    const sparse = new Array(2)
    const arrayWithExtra = Object.assign([1], { extra: true })
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        throw new Error('getter must not run')
      },
    })
    const symbolKey = { [Symbol('hidden')]: 'value' }

    for (const value of [cyclic, sparse, arrayWithExtra, accessor, symbolKey]) {
      expect(() => canonicalizeJsonForIdempotency(value, 1024)).toThrowError(
        CanonicalJsonError,
      )
    }
    expect(() => canonicalizeJsonForIdempotency(accessor, 1024)).toThrowError(
      'Value is not a safe JSON-compatible payload',
    )
  })

  it('rejects non-enumerable object properties and non-plain prototypes', () => {
    const hidden = Object.defineProperty({ visible: 1 }, 'hidden', {
      value: 2,
      enumerable: false,
    })

    expect(() => canonicalizeJsonForIdempotency(hidden, 1024)).toThrowError(
      CanonicalJsonError,
    )
    expect(() => canonicalizeJsonForIdempotency(Object.create({ inherited: true }), 1024)).toThrowError(
      CanonicalJsonError,
    )
  })

  it('enforces a caller-supplied payload byte limit without assuming one global limit', () => {
    expect(() => canonicalizeJsonForIdempotency({ value: 'ééé' }, 10)).toThrowError(
      expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }),
    )
    expect(() => canonicalizeJsonForIdempotency({ value: 1 }, 0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_MAX_BYTES' }),
    )
  })

  it('wraps cryptographic provider failures without leaking provider details', async () => {
    const digest = vi.fn(async () => {
      throw new Error('internal crypto implementation detail')
    })

    await expect(
      sha256CanonicalJsonForIdempotency({ value: 1 }, 1024, { digest }),
    ).rejects.toMatchObject({ code: 'HASH_UNAVAILABLE' })
    expect(digest).toHaveBeenCalledTimes(1)
  })

  it('does not mutate the caller input', () => {
    const payload = Object.freeze({
      z: 1,
      nested: Object.freeze({ b: 2, a: 1 }),
    })
    const before = { z: 1, nested: { b: 2, a: 1 } }

    canonicalizeJsonForIdempotency(payload, 1024)

    expect(payload).toEqual(before)
    expect(payload.nested).toEqual(before.nested)
  })
})
