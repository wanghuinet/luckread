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


  it('replays a completed same-key request before the case version check', async () => {
    const canonical = JSON.stringify(
      Object.fromEntries(
        Object.entries({
          operationId: 'decideModerationCase',
          caseId: baseInput.caseId,
          expectedVersion: baseInput.expectedVersion,
          decision: baseInput.decision,
          policyVersion: baseInput.policyVersion,
          reasonCode: baseInput.reasonCode,
          severity: baseInput.severity,
          scope: baseInput.scope,
          effectiveAt: baseInput.effectiveAt,
          expiresAt: baseInput.expiresAt,
        }).sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    const hash = (await import('node:crypto')).createHash('sha256').update(canonical).digest('hex')
    const storedResponse = {
      caseId: baseInput.caseId,
      decisionId: 'dec_replay_1',
      outcome: 'APPROVED' as const,
      version: 2,
      effectiveAt: baseInput.effectiveAt,
      requestId: baseInput.requestId,
    }
    const prepared = {
      bind: () => ({
        first: async () => ({
          case_id: baseInput.caseId,
          target_type: 'content',
          target_id: 'content_1',
          target_version: 1,
          policy_version: 'moderation-v1.0',
          state: 'ACTION_TAKEN',
          priority: 100,
          assigned_reviewer_id: null,
          current_decision_id: 'dec_replay_1',
          evidence_bundle_ref: 'e2e/replay',
          version: 2,
          created_at: baseInput.effectiveAt,
          updated_at: baseInput.effectiveAt,
          idem_request_hash: hash,
          idem_response_json: JSON.stringify(storedResponse),
          idem_expires_at: '2099-01-01T00:00:00.000Z',
        }),
      }),
    }
    const db = {
      prepare: () => prepared,
      batch: async () => { throw new Error('replay must not execute a new transaction') },
    } as unknown as D1Database
    const w03 = {
      fetch: async () => { throw new Error('replay must not call W03') },
    } as unknown as Fetcher

    await expect(
      decideModerationCase(db, w03, { ...baseInput, ifMatch: '"v1"', expectedVersion: 1 }),
    ).resolves.toEqual(storedResponse)
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
