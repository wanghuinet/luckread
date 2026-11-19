import { describe, expect, it, vi } from 'vitest'

import {
  createPostgresModerationReportWriteStore,
} from './moderation-report-write-store-postgres.js'
import type { ModerationReportWriteCommand } from './moderation-report-write-store.js'
import {
  ModerationReportWriteStoreError,
} from './moderation-report-write-store.js'
import type {
  W06ModerationPostgresClient,
  W06ModerationPostgresPool,
} from './moderation-postgres-pool.js'

const command: ModerationReportWriteCommand = {
  actorUserId: 'user_1',
  targetType: 'content',
  targetId: 'content_1',
  reasonCode: 'SPAM',
  description: 'spam',
  evidenceRefs: ['evidence://1'],
  policyVersion: 'report-v1',
  dedupBucket: '20600',
  requestHash: 'a'.repeat(64),
  idempotencyKey: 'idem_1',
  idempotencyId: 'idem-row-1',
  reportId: 'report_' + 'b'.repeat(64),
  auditEventId: 'audit_1',
  requestId: 'req_report_1',
  correlationId: 'corr_1',
  createdAt: '2026-11-19T12:00:00.000Z',
  expiresAt: '2026-11-20T12:00:00.000Z',
}

type ScriptedResponse = {
  match: string
  rows?: Array<Record<string, unknown>>
  rowCount?: number
  error?: Error
}

function fakePool(responses: ScriptedResponse[] = []) {
  const calls: Array<{ sql: string; values?: unknown[] }> = []
  let index = 0
  const query = vi.fn(async <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => {
    calls.push({ sql, values })
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] as Row[], rowCount: 0 }
    }
    const response = responses[index++]
    if (!response || !sql.includes(response.match)) {
      throw new Error('unexpected PostgreSQL statement: ' + sql)
    }
    if (response.error) throw response.error
    return {
      rows: (response.rows ?? []) as Row[],
      rowCount: response.rowCount ?? response.rows?.length ?? 0,
    }
  })
  const client: W06ModerationPostgresClient = { query, release: vi.fn() }
  const pool: W06ModerationPostgresPool = {
    async query<Row extends Record<string, unknown> = Record<string, unknown>>() {
      return { rows: [] as Row[], rowCount: 0 }
    },
    async connect() { return client },
  }
  return { pool, client, calls, query }
}

describe('W06 native PostgreSQL report write store', () => {
  it('commits a new report, its W09 append-only AuditEvent and idempotency record atomically', async () => {
    const fake = fakePool([
      { match: 'FROM moderation_report_idempotency' },
      { match: 'FROM moderation_reports' },
      { match: 'INSERT INTO moderation_reports', rowCount: 1 },
      { match: 'INSERT INTO audit_events', rowCount: 1 },
      { match: 'INSERT INTO moderation_report_idempotency', rowCount: 1 },
    ])

    const result = await createPostgresModerationReportWriteStore(fake.pool).create(command)

    expect(result).toMatchObject({
      reportId: command.reportId,
      targetType: 'content',
      targetId: 'content_1',
      reasonCode: 'SPAM',
      status: 'CREATED',
      createdAt: command.createdAt,
    })
    expect(fake.calls[0]?.sql).toBe('BEGIN')
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT')
    expect(fake.client.release).toHaveBeenCalledOnce()

    const reportInsert = fake.calls.find((call) => call.sql.includes('INSERT INTO moderation_reports'))
    expect(reportInsert?.sql).toContain('ON CONFLICT DO NOTHING')
    expect(reportInsert?.values).toEqual([
      command.reportId, command.actorUserId, command.targetType, command.targetId,
      command.reasonCode, command.description, JSON.stringify(command.evidenceRefs),
      command.policyVersion, command.dedupBucket, command.createdAt,
    ])

    const auditInsert = fake.calls.find((call) => call.sql.includes('INSERT INTO audit_events'))
    expect(auditInsert?.values).toEqual([
      command.auditEventId,
      command.requestId,
      { actorId: command.actorUserId, actorType: 'user' },
      'moderation.report.created',
      'Report',
      command.reportId,
      {},
      {
        reportId: command.reportId,
        targetType: command.targetType,
        targetId: command.targetId,
        reasonCode: command.reasonCode,
        policyVersion: command.policyVersion,
        correlationId: command.correlationId,
      },
      command.reasonCode,
      command.createdAt,
    ])
    expect(fake.calls.find((call) => call.sql.includes('INSERT INTO moderation_report_idempotency'))?.values)
      .toEqual([
        command.idempotencyId, command.actorUserId, command.idempotencyKey, command.requestHash,
        command.reportId, 201, JSON.stringify(result), command.createdAt, command.expiresAt,
      ])
  })

  it('does not append AuditEvent when PostgreSQL ignores a duplicate report insert', async () => {
    const fake = fakePool([
      { match: 'FROM moderation_report_idempotency' },
      { match: 'FROM moderation_reports' },
      { match: 'INSERT INTO moderation_reports', rowCount: 0 },
      { match: 'INSERT INTO moderation_report_idempotency', rowCount: 1 },
    ])

    const result = await createPostgresModerationReportWriteStore(fake.pool).create(command)

    expect(result.status).toBe('CREATED')
    expect(fake.calls.some((call) => call.sql.includes('INSERT INTO audit_events'))).toBe(false)
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('returns the stored response for a matching idempotency replay without writing again', async () => {
    const stored = {
      reportId: command.reportId,
      targetType: 'content',
      targetId: command.targetId,
      reasonCode: command.reasonCode,
      status: 'CREATED',
      createdAt: command.createdAt,
    }
    const fake = fakePool([
      {
        match: 'FROM moderation_report_idempotency',
        rows: [{ report_id: command.reportId, request_hash: command.requestHash, response_json: JSON.stringify(stored) }],
      },
    ])

    await expect(createPostgresModerationReportWriteStore(fake.pool).create(command)).resolves.toEqual(stored)
    expect(fake.calls.map((call) => call.sql)).toEqual(['BEGIN', expect.stringContaining('FROM moderation_report_idempotency'), 'COMMIT'])
  })

  it('deduplicates an earlier same-actor target/reason report without appending a second audit event', async () => {
    const fake = fakePool([
      { match: 'FROM moderation_report_idempotency' },
      {
        match: 'FROM moderation_reports',
        rows: [{
          report_id: 'report_prior',
          target_type: 'content',
          target_id: command.targetId,
          reason_code: command.reasonCode,
          created_at: new Date(command.createdAt),
        }],
      },
      { match: 'INSERT INTO moderation_report_idempotency', rowCount: 1 },
    ])

    const result = await createPostgresModerationReportWriteStore(fake.pool).create(command)
    expect(result).toMatchObject({
      reportId: 'report_prior',
      status: 'DEDUPLICATED',
      createdAt: command.createdAt,
    })
    expect(fake.calls.some((call) => call.sql.includes('INSERT INTO audit_events'))).toBe(false)
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT')
  })

  it('rolls the report back when the W09 AuditEvent append fails', async () => {
    const fake = fakePool([
      { match: 'FROM moderation_report_idempotency' },
      { match: 'FROM moderation_reports' },
      { match: 'INSERT INTO moderation_reports', rowCount: 1 },
      { match: 'INSERT INTO audit_events', error: new Error('database internal detail') },
    ])

    const store = createPostgresModerationReportWriteStore(fake.pool)
    let failure: unknown
    try {
      await store.create(command)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ModerationReportWriteStoreError)
    expect(failure).toMatchObject({
      code: 'REPORT_WRITE_FAILED',
      status: 500,
      message: 'REPORT_WRITE_FAILED',
    })
    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK')
    expect(fake.client.release).toHaveBeenCalledOnce()
  })

  it('rolls back a same-key race with a different command instead of retaining an orphan report', async () => {
    const fake = fakePool([
      { match: 'FROM moderation_report_idempotency' },
      { match: 'FROM moderation_reports' },
      { match: 'INSERT INTO moderation_reports', rowCount: 1 },
      { match: 'INSERT INTO audit_events', rowCount: 1 },
      { match: 'INSERT INTO moderation_report_idempotency', rowCount: 0 },
      {
        match: 'FROM moderation_report_idempotency',
        rows: [{
          report_id: 'report_other',
          request_hash: 'different-hash',
          response_json: JSON.stringify({ reportId: 'report_other' }),
        }],
      },
    ])

    await expect(createPostgresModerationReportWriteStore(fake.pool).create(command))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK')
  })
})
