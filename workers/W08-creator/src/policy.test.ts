import { describe, expect, it } from 'vitest'
import {
  mayApplyForCreator,
  mayReviewCreatorApplication,
  parseExpectedVersion,
  validIdempotencyKey,
} from './policy.js'

describe('creator authorization admission', () => {
  it('permits only a global L2 user to apply without trusting a body role', () => {
    expect(mayApplyForCreator('L2')).toBe(true)
    expect(mayApplyForCreator('L3')).toBe(false)
    expect(mayApplyForCreator('L7')).toBe(false)
    expect(mayApplyForCreator('L1')).toBe(false)
    expect(mayApplyForCreator(null)).toBe(false)
  })

  it('restricts creator application review and grant initiation to L7/L8', () => {
    expect(mayReviewCreatorApplication('L7')).toBe(true)
    expect(mayReviewCreatorApplication('L8')).toBe(true)
    expect(mayReviewCreatorApplication('L6')).toBe(false)
    expect(mayReviewCreatorApplication('L3')).toBe(false)
  })

  it('parses strong version preconditions and rejects weak or malformed values', () => {
    expect(parseExpectedVersion('"3"')).toBe(3)
    expect(parseExpectedVersion('W/"4"')).toBe(4)
    expect(parseExpectedVersion(null)).toBeNull()
    expect(parseExpectedVersion('*')).toBeNull()
    expect(parseExpectedVersion('0')).toBeNull()
  })

  it('requires bounded, printable idempotency keys', () => {
    expect(validIdempotencyKey('creator-apply-2026-10-12')).toBe(true)
    expect(validIdempotencyKey('')).toBe(false)
    expect(validIdempotencyKey('key with spaces')).toBe(false)
    expect(validIdempotencyKey('x'.repeat(201))).toBe(false)
  })
})
