import { describe, expect, it } from 'vitest'
import {
  admitCreatorDecision,
  creatorApplicationReplayMatches,
  parseExpectedVersion,
  validIdempotencyKey,
} from './policy.js'

describe('creator authorization admission', () => {
  it('recognizes exact application retries but rejects a reused key with changed content', () => {
    const existing = { creator_type: 'WRITER', statement: 'I publish long-form articles.' }
    expect(creatorApplicationReplayMatches(existing, { creatorType: 'WRITER', statement: 'I publish long-form articles.' })).toBe(true)
    expect(creatorApplicationReplayMatches(existing, { creatorType: 'VIDEO_CREATOR', statement: 'I publish long-form articles.' })).toBe(false)
    expect(creatorApplicationReplayMatches(existing, { creatorType: 'WRITER', statement: 'Changed statement.' })).toBe(false)
  })

  it('denies self-review and rejects an already-final application with a different decision', () => {
    const base = {
      applicationStatus: 'APPROVED',
      requestedDecision: 'REJECTED' as const,
      applicantId: 'applicant-0001',
      actorId: 'reviewer-0001',
      storedDecision: 'APPROVED',
      storedActorId: 'reviewer-0001',
      storedIdempotencyKey: 'creator-review:app-0001:1:APPROVED',
      requestIdempotencyKey: 'creator-review:app-0001:2:REJECTED',
    }
    expect(admitCreatorDecision({ ...base, actorId: 'applicant-0001' })).toBe('SELF_APPROVAL_DENIED')
    expect(admitCreatorDecision(base)).toBe('DECISION_CONFLICT')
  })

  it('permits an exact decision replay only for the same reviewer and idempotency key', () => {
    const base = {
      applicationStatus: 'APPROVED',
      requestedDecision: 'APPROVED' as const,
      applicantId: 'applicant-0001',
      actorId: 'reviewer-0001',
      storedDecision: 'APPROVED',
      storedActorId: 'reviewer-0001',
      storedIdempotencyKey: 'creator-review:app-0001:1:APPROVED',
      requestIdempotencyKey: 'creator-review:app-0001:1:APPROVED',
    }
    expect(admitCreatorDecision(base)).toBe('REPLAY')
    expect(admitCreatorDecision({ ...base, actorId: 'reviewer-0002' })).toBe('DECISION_CONFLICT')
    expect(admitCreatorDecision({ ...base, requestIdempotencyKey: 'another-key' })).toBe('DECISION_CONFLICT')
  })

  it('accepts only the strong version ETag returned by the application endpoint', () => {
    expect(parseExpectedVersion('"3"')).toBe(3)
    expect(parseExpectedVersion(null)).toBeNull()
    expect(parseExpectedVersion('W/"4"')).toBeNull()
    expect(parseExpectedVersion('3')).toBeNull()
    expect(parseExpectedVersion('*')).toBeNull()
    expect(parseExpectedVersion('"3", "4"')).toBeNull()
    expect(parseExpectedVersion('"0"')).toBeNull()
  })

  it('requires bounded, printable idempotency keys', () => {
    expect(validIdempotencyKey('creator-apply-2026-10-12')).toBe(true)
    expect(validIdempotencyKey('')).toBe(false)
    expect(validIdempotencyKey('key with spaces')).toBe(false)
    expect(validIdempotencyKey('x'.repeat(201))).toBe(false)
  })
})
