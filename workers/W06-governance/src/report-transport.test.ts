import { describe, expect, it, vi } from 'vitest'

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

const env = {
  HYPERDRIVE_D1_03: {
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/luckread_governance',
  },
}

const created = {
  reportId: 'report_test',
  targetType: 'content',
  targetId: 'content-1',
  reasonCode: 'SPAM',
  status: 'CREATED' as const,
  createdAt: '2026-11-19T00:00:00.000Z',
}

async function withReportWorker<T>(
  store: { create: ReturnType<typeof vi.fn> },
  run: (worker: typeof import('./index').default) => Promise<T>,
): Promise<T> {
  vi.resetModules()
  vi.doMock('./neon/moderation-database-runtime.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./neon/moderation-database-runtime.js')>()
    return {
      ...actual,
      getW06ModerationReportWriteStore: () => store,
    }
  })
  try {
    const runtime = await import('./index')
    return await run(runtime.default)
  } finally {
    vi.doUnmock('./neon/moderation-database-runtime.js')
    vi.resetModules()
  }
}

describe('W06 report transport', () => {
  it('creates a report through the authenticated W01 boundary and the Neon Store', async () => {
    const store = { create: vi.fn(async () => created) }
    await withReportWorker(store, async (worker) => {
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
        env as never,
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
      expect(store.create).toHaveBeenCalledOnce()
      expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: 'user-1',
        targetType: 'content',
        targetId: 'content-1',
        reasonCode: 'SPAM',
        idempotencyKey: 'report-test-1',
        requestId: 'req_report_test',
        correlationId: 'corr-report-test',
      }))
    })
  })

  it('fails closed without the authenticated transport principal before Store access', async () => {
    const store = { create: vi.fn(async () => created) }
    await withReportWorker(store, async (worker) => {
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
        env as never,
      )

      expect(response.status).toBe(401)
      expect(store.create).not.toHaveBeenCalled()
    })
  })

  it('rejects malformed report payloads before Store access', async () => {
    const store = { create: vi.fn(async () => created) }
    await withReportWorker(store, async (worker) => {
      const response = await worker.fetch(
        new Request('https://luckread-w06.internal/reports', {
          method: 'POST',
          headers,
          body: JSON.stringify({ targetType: 'other', targetId: 'x', reasonCode: 'SPAM' }),
        }),
        env as never,
      )
      expect(response.status).toBe(400)
      expect(store.create).not.toHaveBeenCalled()
    })
  })
})
