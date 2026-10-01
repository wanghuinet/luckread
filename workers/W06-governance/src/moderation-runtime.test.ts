import { describe, expect, it } from 'vitest'
import { ModerationRuntimeError, decideModerationCase } from './moderation-runtime'

const baseInput = {
  reviewerId: 'reviewer_1',
  reviewerLayer: 'L6',
  caseId: 'case_1',
  ifMatch: '"v1"',
  idempotencyKey: 'idem_1',
  correlationId: 'trace-1',
  requestId: 'req_1',
  expectedVersion: 1,
  decision: 'APPROVED' as const,
  policyVersion: 'moderation-v1.0',
  reasonCode: 'POLICY_MATCH',
  severity: 'medium',
  scope: 'content',
  effectiveAt: '2026-10-01T00:00:00.000Z',
  expiresAt: null,
}

describe('moderation runtime admission guards', () => {
  it('rejects reviewer layers below L6 before any D1 access', async () => {
    const db = {} as D1Database
    const w03 = {} as Fetcher
    await expect(
      decideModerationCase(db, w03, { ...baseInput, reviewerLayer: 'L5' }),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })
  })

  it('requires both optimistic concurrency and idempotency headers', async () => {
    const db = {} as D1Database
    const w03 = {} as Fetcher
    await expect(
      decideModerationCase(db, w03, { ...baseInput, ifMatch: null }),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_REQUIRED',
      status: 428,
    })
  })

  it('fails closed on malformed reviewer layer', async () => {
    const db = {} as D1Database
    const w03 = {} as Fetcher
    await expect(
      decideModerationCase(db, w03, { ...baseInput, reviewerLayer: 'admin' }),
    ).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
      status: 403,
    })
  })

  it('uses a typed moderation runtime error for denied authority', () => {
    const error = new ModerationRuntimeError('PERMISSION_DENIED', 403)
    expect(error.status).toBe(403)
    expect(error.code).toBe('PERMISSION_DENIED')
  })
})
