import { describe, expect, it } from 'vitest'
import {
  createPostgresModerationCaseDetailReadStore,
  ModerationCaseDetailReadStoreError,
  type ModerationCaseDetailPostgresQueryExecutor,
  type ModerationCaseDetailReadRow,
} from './moderation-case-detail-read-store-postgres.js'

const row: ModerationCaseDetailReadRow = {
  case_id: 'case_1',
  target_type: 'content',
  target_id: 'content_1',
  target_version: 4,
  policy_version: 'moderation-v1',
  state: 'ACTION_TAKEN',
  priority: 80,
  assigned_reviewer_id: 'reviewer_1',
  current_decision_id: 'decision_1',
  evidence_bundle_ref: 'evidence/case_1',
  version: 3,
  created_at: '2026-11-19T03:00:00.123456Z',
  updated_at: '2026-11-19T03:02:00.654321Z',
  decision_id: 'decision_1',
  case_version: 3,
  outcome: 'APPROVED',
  decision_policy_version: 'moderation-v1',
  decision_effective_at: '2026-11-19T03:02:00.654321Z',
  reason_code: 'POLICY_MATCH',
  severity: 'medium',
  scope: 'content',
  expires_at: null,
  source_kind: 'HUMAN_REVIEW',
  reviewer_id: 'reviewer_1',
  reviewer_layer: 'L6',
  request_id: 'req_case_1',
  decision_created_at: '2026-11-19T03:02:00.654321Z',
  decision_target_type: 'content',
  decision_target_id: 'content_1',
  decision_target_version: 4,
}

describe('W06 native PostgreSQL moderation case detail reader', () => {
  it('scopes the case and current decision to the authenticated reviewer', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db: ModerationCaseDetailPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [row] as unknown as Row[] }
      },
    }

    const result = await createPostgresModerationCaseDetailReadStore(db).get(
      'case_1',
      'reviewer_1',
    )

    expect(result).toEqual(row)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.values).toEqual(['case_1', 'reviewer_1'])
    expect(calls[0]?.sql).toContain('c.case_id = $1')
    expect(calls[0]?.sql).toContain("c.target_type = 'content'")
    expect(calls[0]?.sql).toContain('(c.assigned_reviewer_id IS NULL OR c.assigned_reviewer_id = $2)')
    expect(calls[0]?.sql).toContain('LEFT JOIN moderation_decisions d ON d.decision_id = c.current_decision_id')
    expect(calls[0]?.sql).toContain('HH24:MI:SS.US')
    expect(calls[0]?.sql).toContain('AS expires_at')
    expect(calls[0]?.sql).not.toContain('sqlite_master')
    expect(calls[0]?.sql).not.toContain('?')
  })

  it('returns null when the case is not visible to the reviewer', async () => {
    const db: ModerationCaseDetailPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        return { rows: [] as Row[] }
      },
    }

    await expect(
      createPostgresModerationCaseDetailReadStore(db).get('case_missing', 'reviewer_1'),
    ).resolves.toBeNull()
  })

  it('maps PostgreSQL errors to a sanitized service-unavailable error', async () => {
    const db: ModerationCaseDetailPostgresQueryExecutor = {
      async query<Row extends Record<string, unknown>>() {
        throw new Error('private PostgreSQL connection and SQL detail')
      },
    }

    await expect(
      createPostgresModerationCaseDetailReadStore(db).get('case_1', 'reviewer_1'),
    ).rejects.toBeInstanceOf(ModerationCaseDetailReadStoreError)
    await expect(
      createPostgresModerationCaseDetailReadStore(db).get('case_1', 'reviewer_1'),
    ).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
      message: 'MODERATION_CASE_READ_UNAVAILABLE',
    })
  })
})
