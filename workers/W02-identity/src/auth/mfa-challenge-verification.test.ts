import { describe, expect, it } from 'vitest'
import { isUnexpiredMfaChallengeRecord } from './mfa-challenge-verification'

describe('AUTH-007 signed MFA challenge expiry guard', () => {
  const now = Date.parse('2026-10-26T12:00:00.000Z')

  it('accepts an identity-bound challenge record only while its expiry is in the future', () => {
    expect(isUnexpiredMfaChallengeRecord({
      value: 'user-123',
      expiresAt: '2026-10-26T12:00:00.001Z',
    }, now)).toBe(true)
  })

  it('rejects an expired challenge record at and after its exact expiry instant', () => {
    expect(isUnexpiredMfaChallengeRecord({
      value: 'user-123',
      expiresAt: '2026-10-26T12:00:00.000Z',
    }, now)).toBe(false)
    expect(isUnexpiredMfaChallengeRecord({
      value: 'user-123',
      expiresAt: '2026-10-26T11:59:59.999Z',
    }, now)).toBe(false)
  })

  it('fails closed for missing, malformed, or empty challenge subjects and malformed expiry', () => {
    expect(isUnexpiredMfaChallengeRecord(null, now)).toBe(false)
    expect(isUnexpiredMfaChallengeRecord(undefined, now)).toBe(false)
    expect(isUnexpiredMfaChallengeRecord({ value: '', expiresAt: '2026-10-26T12:01:00.000Z' }, now)).toBe(false)
    expect(isUnexpiredMfaChallengeRecord({ value: 42, expiresAt: '2026-10-26T12:01:00.000Z' }, now)).toBe(false)
    expect(isUnexpiredMfaChallengeRecord({ value: 'user-123', expiresAt: 'not-a-date' }, now)).toBe(false)
  })

  it('rejects invalid test clocks instead of accidentally treating the record as current', () => {
    const record = { value: 'user-123', expiresAt: '2026-10-26T12:01:00.000Z' }
    expect(isUnexpiredMfaChallengeRecord(record, Number.NaN)).toBe(false)
    expect(isUnexpiredMfaChallengeRecord(record, -1)).toBe(false)
  })
})
