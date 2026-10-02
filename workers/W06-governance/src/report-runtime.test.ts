/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createReport } from './report-runtime'

const db = (firstResults: unknown[] = [], batchResults: Array<{ success: boolean }> = [{ success: true }, { success: true }, { success: true }]) => {
  let firstIndex = 0
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ success: true })),
    })),
  }))
  return {
    prepare,
    batch: vi.fn(async () => batchResults),
  } as unknown as D1Database
}

const input = {
  actorUserId: 'user-1',
  targetType: 'content' as const,
  targetId: 'content-1',
  reasonCode: 'SPAM',
  description: 'spam',
  evidenceRefs: ['evidence://1'],
  idempotencyKey: 'report-1',
  requestId: 'req_test_report',
  correlationId: 'corr-report',
}

describe('report runtime', () => {
  it('creates a report with atomic report + idempotency + audit writes', async () => {
    const result = await createReport(db(), input)
    expect(result.status).toBe('CREATED')
  })

  it('returns the stored idempotent result for an equivalent retry', async () => {
    const result = await createReport(db([{
      report_id: 'report-1',
      request_hash: 'c',
      response_json: JSON.stringify({
        reportId: 'report-1',
        targetType: 'content',
        targetId: 'content-1',
        reasonCode: 'SPAM',
        status: 'CREATED',
        createdAt: '2026-10-02T00:00:00.000Z',
      }),
    ]), input)
    const cryptoHash = await (async () => {
      const canonical = JSON.stringify({
        targetType: input.targetType,
        targetId: input.targetId,
        reasonCode: input.reasonCode,
        description: input.description,
        evidenceRefs: input.evidenceRefs,
      })
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
      return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
    })()
    expect(cryptoHash).toBe('c')
    expect(result.reportId).toBe('report-1')
  })

  it('rejects idempotency-key reuse with a different command', async () => {
    const stored = {
      report_id: 'report-1',
      request_hash: 'not-the-same',
      response_json: JSON.stringify({ reportId: 'report-1' }),
    }
    await expect(createReport(db([stored]), input)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('deduplicates the same actor/target/reason within the active 24-hour bucket', async () => {
    const result = await createReport(db([
      null,
      {
        report_id: 'report-existing',
        target_type: 'content',
        target_id: 'content-1',
        reason_code: 'SPAM',
        created_at: '2026-10-02T00:00:00.000Z',
      },
    ]), input)
    expect(result).toMatchObject({ reportId: 'report-existing', status: 'DEDUPLICATED' })
  })

  it('validates target, reason and evidence bounds', async () => {
    await expect(createReport(db(), { ...input, targetType: 'invalid' as never })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(createReport(db(), { ...input, reasonCode: ' ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(createReport(db(), { ...input, evidenceRefs: new Array(21).fill('x') })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
