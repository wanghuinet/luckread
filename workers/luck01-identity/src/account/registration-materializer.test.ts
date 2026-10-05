import { describe, expect, it } from 'vitest'
import {
  deriveMaterializedIdentityId,
  parseCommittedRegistrationUserId,
} from './registration-materializer.js'

describe('AUTH-001 W02 registration materializer primitives', () => {
  it('extracts the canonical User ID from the committed response', () => {
    expect(parseCommittedRegistrationUserId(JSON.stringify({
      userId: 'user-123',
      accountState: 'PENDING_VERIFICATION',
    }))).toBe('user-123')
  })

  it('rejects malformed or incomplete committed responses', () => {
    expect(parseCommittedRegistrationUserId('not-json')).toBeNull()
    expect(parseCommittedRegistrationUserId(JSON.stringify({
      accountState: 'PENDING_VERIFICATION',
    }))).toBeNull()
    expect(parseCommittedRegistrationUserId(JSON.stringify({
      userId: '',
      accountState: 'PENDING_VERIFICATION',
    }))).toBeNull()
  })

  it('derives a stable opaque identity identifier from the immutable User ID', async () => {
    const first = await deriveMaterializedIdentityId('user-123')
    const second = await deriveMaterializedIdentityId('user-123')
    const other = await deriveMaterializedIdentityId('user-456')

    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^auth1_[0-9a-f]{64}$/)
    expect(first).not.toContain('user-123')
  })
})
