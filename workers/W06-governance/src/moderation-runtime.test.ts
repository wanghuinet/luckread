import { describe, expect, it } from 'vitest'
import { ModerationRuntimeError, decideModerationCase, listModerationQueue } from './moderation-runtime'
import { createPostgresModerationQueueReadStore } from './moderation-queue-read-store-postgres'
import type { ModerationQueuePostgresQueryExecutor } from './moderation-queue-read-store-postgres'

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

  it('keeps D1 as the default moderation queue read adapter', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const row = {
      case_id: 'case_1',
      target_type: 'content',
      target_id: 'content_1',
      target_version: 1,
      policy_version: 'moderation-v1',
      state: 'OPEN',
      priority: 10,
      assigned_reviewer_id: null,
      current_decision_id: null,
      evidence_bundle_ref: null,
      version: 1,
      created_at: '2026-11-10T00:00:00.000Z',
      updated_at: '2026-11-10T00:00:00.000Z',
      decision_id: null,
      case_version: null,
      outcome: null,
      decision_policy_version: null,
      decision_effective_at: null,
      decision_request_id: null,
      decision_created_at: null,
    }
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values })
            return { all: async () => ({ results: [row] }) }
          },
        }
      },
    } as unknown as D1Database

    const result = await listModerationQueue(db, 'reviewer_1', null, 1)

    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.caseId).toBe('case_1')
    expect(result.hasMore).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'APPEALED', 'reviewer_1', 2])
    expect(calls[0]?.sql).toContain('c.state IN (?,?,?,?)')
    expect(calls[0]?.sql).toContain("c.target_type = 'content'")
    expect(calls[0]?.sql).toContain('c.assigned_reviewer_id = ?')
    expect(calls[0]?.sql).toContain('ORDER BY c.priority DESC, c.created_at ASC, c.case_id ASC')
  })

  it('uses the PostgreSQL moderation queue store with identical reviewer and page boundaries', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const makeRow = (caseId: string, priority: number, decisionId: string | null) => ({
      case_id: caseId,
      target_type: 'content',
      target_id: 'content_' + caseId,
      target_version: 2,
      policy_version: 'moderation-v1',
      state: 'OPEN',
      priority,
      assigned_reviewer_id: null,
      current_decision_id: decisionId,
      evidence_bundle_ref: 'evidence/' + caseId,
      version: 2,
      created_at: '2026-11-10T04:02:00.123456Z',
      updated_at: '2026-11-10T04:02:00.123456Z',
      decision_id: decisionId,
      case_version: decisionId ? 2 : null,
      outcome: decisionId ? 'APPROVED' : null,
      decision_policy_version: decisionId ? 'moderation-v1' : null,
      decision_effective_at: decisionId ? '2026-11-10T04:02:00.123456Z' : null,
      decision_request_id: decisionId ? 'req_case_1' : null,
      decision_created_at: decisionId ? '2026-11-10T04:02:00.123456Z' : null,
    })
    const db: ModerationQueuePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [
          makeRow('case_1', 90, 'decision_1'),
          makeRow('case_2', 80, null),
          makeRow('case_3', 70, null),
        ] as unknown as Row[] }
      },
    }

    const result = await listModerationQueue(
      createPostgresModerationQueueReadStore(db),
      'reviewer_1',
      null,
      2,
    )

    expect(result.items.map((item) => item.caseId)).toEqual(['case_1', 'case_2'])
    expect(result.items[0]?.currentDecision).toEqual({
      decisionId: 'decision_1',
      outcome: 'APPROVED',
      policyVersion: 'moderation-v1',
      effectiveAt: '2026-11-10T04:02:00.123456Z',
    })
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBeTruthy()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual([['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'APPEALED'], 'reviewer_1', 3])
    expect(calls[0]?.sql).toContain('c.state = ANY($1::text[])')
    expect(calls[0]?.sql).toContain("c.target_type = 'content'")
    expect(calls[0]?.sql).toContain('(c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = $2)')
    expect(calls[0]?.sql).toContain('ORDER BY c.priority DESC, c.created_at ASC, c.case_id ASC')
    expect(calls[0]?.sql).toContain('LIMIT $3')
    expect(calls[0]?.sql).toContain('HH24:MI:SS.US')
  })

  it('preserves microsecond queue cursors in PostgreSQL keyset pagination', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ModerationQueuePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [] as Row[] }
      },
    }
    const encoded = btoa(JSON.stringify({
      version: 1,
      reviewerId: 'reviewer_1',
      priority: 40,
      createdAt: '2026-11-10T04:02:00.123456Z',
      caseId: 'case_cursor',
    })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')

    await listModerationQueue(createPostgresModerationQueueReadStore(db), 'reviewer_1', encoded, 1)

    expect(calls[0]?.values).toEqual([
      ['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'APPEALED'],
      'reviewer_1',
      40,
      '2026-11-10T04:02:00.123456Z',
      'case_cursor',
      2,
    ])
    expect(calls[0]?.sql).toContain('c.created_at > $4::timestamptz')
    expect(calls[0]?.sql).toContain('c.created_at = $4::timestamptz AND c.case_id > $5')
  })

  it('maps PostgreSQL queue failures to a sanitized service-unavailable error', async () => {
    const db: ModerationQueuePostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('private-postgres-driver-detail')
      },
    }

    await expect(
      listModerationQueue(createPostgresModerationQueueReadStore(db), 'reviewer_1', null, 20),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'SERVICE_UNAVAILABLE',
    })
  })

})
