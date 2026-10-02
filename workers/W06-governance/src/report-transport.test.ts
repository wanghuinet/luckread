/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import worker from './index'

const makeDb = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ success: true })),
    })),
  }))
  return {
    prepare,
    batch: vi.fn(async () => [{ success: true }, { success: true }, { success: true }]),
  } as unknown as D1Database
}

const headers = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Principal-User-Id': 'user-1',
  'X-LuckRead-Principal-Layer': 'L2',
  'X-LuckRead-Correlation-Id': 'corr-report-test',
  'X-LuckRead-Request-Id': 'req_report_test',
  'Idempotency-Key': 'report-test-1',
  'content-type': 'application/json',
}

describe('W06 report transport', () => {
  it('creates a report through the authenticated W01 boundary', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w06.internal/reports', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          targetType: 'content',
          targetId: 'content-1',
          reasonCode: 'SPAM',
        }),
      }),
      { D1_03: makeDb() },
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        targetType: 'content',
        targetId: 'content-1',
        reasonCode: 'SPAM',
        status: 'CREATED',
      },
      requestId: 'req_report_test',
    })
  })

  it('fails closed without the authenticated transport principal', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w06.internal/reports', {
        method: 'POST',
        headers: {
          'X-LuckRead-Caller': 'W01',
          'X-LuckRead-Transport-Version': '1.0',
        },
        body: JSON.stringify({
          targetType: 'content',
          targetId: 'content-1',
          reasonCode: 'SPAM',
        }),
      }),
      { D1_03: makeDb() },
    )

    expect(response.status).toBe(401)
  })

  it('rejects malformed report payloads', async () => {
    const response = await worker.fetch(
      new Request('https://luckread-w06.internal/reports', {
        method: 'POST',
        headers,
        body: JSON.stringify({ targetType: 'other', targetId: 'x', reasonCode: 'SPAM' }),
      }),
      { D1_03: makeDb() },
    )
    expect(response.status).toBe(400)
  })
})
