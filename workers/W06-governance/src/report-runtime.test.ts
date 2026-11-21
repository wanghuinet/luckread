import { describe, expect, it, vi } from 'vitest'

import {
  createReport,
  ReportRuntimeError,
  type ReportCreateInput,
} from './report-runtime'
import type {
  ModerationReportWriteCommand,
  ModerationReportWriteStore,
  ReportResult,
} from './moderation-report-write-store'
import { ModerationReportWriteStoreError } from './moderation-report-write-store'

const input: ReportCreateInput = {
  actorUserId: 'user-1',
  targetType: 'content',
  targetId: 'content-1',
  reasonCode: 'SPAM',
  description: ' spam ',
  evidenceRefs: [' evidence://1 '],
  idempotencyKey: 'report-1',
  requestId: 'req_test_report',
  correlationId: 'corr-report',
}

const created: ReportResult = {
  reportId: 'report_test',
  targetType: 'content',
  targetId: 'content-1',
  reasonCode: 'SPAM',
  status: 'CREATED',
  createdAt: '2026-11-19T00:00:00.000Z',
}

function fakeStore(result: ReportResult = created) {
  const create = vi.fn(async (_command: ModerationReportWriteCommand) => result)
  const store: ModerationReportWriteStore = { create }
  return { store, create }
}

describe('report runtime', () => {
  it('validates and normalizes a report command before delegating persistence', async () => {
    const { store, create } = fakeStore()
    const result = await createReport(store, input)

    expect(result).toBe(created)
    expect(create).toHaveBeenCalledOnce()
    const command = create.mock.calls[0]![0]
    expect(command).toMatchObject({
      actorUserId: 'user-1',
      targetType: 'content',
      targetId: 'content-1',
      reasonCode: 'SPAM',
      description: 'spam',
      evidenceRefs: ['evidence://1'],
      policyVersion: 'report-v1',
      requestId: 'req_test_report',
      correlationId: 'corr-report',
    })
    expect(command.requestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(command.reportId).toMatch(/^report_[a-f0-9]{64}$/)
    expect(command.idempotencyId).toMatch(/^[0-9a-f-]{36}$/)
    expect(command.auditEventId).toMatch(/^[0-9a-f-]{36}$/)
    expect(command.dedupBucket).toMatch(/^\d+$/)
    expect(Date.parse(command.expiresAt) - Date.parse(command.createdAt)).toBe(24 * 60 * 60 * 1000)
  })

  it('returns a native store deduplication result unchanged', async () => {
    const deduplicated: ReportResult = { ...created, reportId: 'report_existing', status: 'DEDUPLICATED' }
    const { store } = fakeStore(deduplicated)
    await expect(createReport(store, input)).resolves.toEqual(deduplicated)
  })

  it('rejects invalid target, reason and evidence before invoking the store', async () => {
    const { store, create } = fakeStore()
    await expect(createReport(store, { ...input, targetType: 'invalid' as never }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(createReport(store, { ...input, reasonCode: ' ' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(createReport(store, { ...input, evidenceRefs: new Array(21).fill('x') }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    await expect(createReport(store, { ...input, idempotencyKey: ' ' }))
      .rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 })
    expect(create).not.toHaveBeenCalled()
  })

  it('maps native idempotency conflicts to the public report error contract', async () => {
    const store: ModerationReportWriteStore = {
      async create() {
        throw new ModerationReportWriteStoreError('CONFLICT', 409)
      },
    }
    await expect(createReport(store, input)).rejects.toBeInstanceOf(ReportRuntimeError)
    await expect(createReport(store, input)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('sanitizes unknown persistence errors', async () => {
    const store: ModerationReportWriteStore = {
      async create() { throw new Error('sensitive database detail') },
    }
    await expect(createReport(store, input)).rejects.toMatchObject({
      code: 'REPORT_WRITE_FAILED',
      status: 500,
      message: 'REPORT_WRITE_FAILED',
    })
  })
})
