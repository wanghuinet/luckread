import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSessionById: vi.fn(),
  enforcePublicReadRateLimit: vi.fn(),
  enforceW01WriteRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('rate limited', { status: 429 })),
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  listSessions: mocks.listSessions,
  revokeSessionById: mocks.revokeSessionById,
  W02AuthClientError: class extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforcePublicReadRateLimit: mocks.enforcePublicReadRateLimit,
  enforceW01WriteRateLimit: mocks.enforceW01WriteRateLimit,
  rateLimitResponse: mocks.rateLimitResponse,
  TrafficLimitError: class extends Error {},
}))

import { DELETE, GET } from '../../src/app/auth/sessions/[[...segments]]/route.js'
import { TrafficLimitError } from '../../src/auth/traffic-limit.js'

const context = (segments: string[] = []) => ({ params: Promise.resolve({ segments }) })

describe('session management route behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listSessions.mockReset()
    mocks.revokeSessionById.mockReset()
    mocks.enforcePublicReadRateLimit.mockResolvedValue(undefined)
    mocks.enforceW01WriteRateLimit.mockResolvedValue(undefined)
    mocks.revokeSessionById.mockResolvedValue(undefined)
  })

  it('returns the W02 session-list envelope without allowing shared caching', async () => {
    mocks.listSessions.mockResolvedValue({
      items: [
        { sessionId: 'session-2', createdAt: '2026-10-02T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', lastSeenAt: null },
      ],
      currentSessionId: 'session-2',
      nextCursor: null,
    })

    const response = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?limit=2', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      context(),
    )
    const payload = await response.json() as { items: Array<{ sessionId: string }>; currentSessionId: string; nextCursor: string | null }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload.currentSessionId).toBe('session-2')
    expect(payload.items.map((item) => item.sessionId)).toEqual(['session-2'])
    expect(mocks.listSessions).toHaveBeenCalledWith(expect.any(Request), { limit: 2 })
    expect(mocks.enforcePublicReadRateLimit).toHaveBeenCalledTimes(1)
  })

  it('caps public results at 50 even when the client requests 100 and forwards the cursor', async () => {
    mocks.listSessions.mockResolvedValue({ items: [], currentSessionId: 'session-1', nextCursor: null })

    const response = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?limit=100&cursor=s1.example'),
      context(),
    )

    expect(response.status).toBe(200)
    expect(mocks.listSessions).toHaveBeenCalledWith(expect.any(Request), { limit: 50, cursor: 's1.example' })
  })

  it('rejects an invalid limit or empty cursor before calling W02', async () => {
    const invalidLimit = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?limit=101'),
      context(),
    )
    expect(invalidLimit.status).toBe(400)
    expect(mocks.listSessions).not.toHaveBeenCalled()

    const invalidCursor = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?cursor='),
      context(),
    )
    expect(invalidCursor.status).toBe(400)
    expect(mocks.listSessions).not.toHaveBeenCalled()
  })

  it('revokes an addressed session through W02 and returns no content', async () => {
    const request = new Request('https://luckread.test/api/v1/auth/sessions/session-other', {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'session-revoke-test-1' },
    })

    const response = await DELETE(request, context(['session-other']))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.revokeSessionById).toHaveBeenCalledWith(request, 'session-other')
    expect(mocks.enforceW01WriteRateLimit).toHaveBeenCalledTimes(1)
  })

  it('returns 429 and skips W02 when the public-read limiter is exhausted', async () => {
    const request = new Request('https://luckread.test/api/v1/auth/sessions?limit=2')
    mocks.enforcePublicReadRateLimit.mockRejectedValueOnce(new TrafficLimitError())

    const response = await GET(request, context())

    expect(response.status).toBe(429)
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(request)
    expect(mocks.listSessions).not.toHaveBeenCalled()
  })

  it('returns 429 and skips revocation when the write limiter is exhausted', async () => {
    const request = new Request('https://luckread.test/api/v1/auth/sessions/session-other', {
      method: 'DELETE',
      headers: { 'Idempotency-Key': 'session-revoke-rate-limit-test' },
    })
    mocks.enforceW01WriteRateLimit.mockRejectedValueOnce(new TrafficLimitError())

    const response = await DELETE(request, context(['session-other']))

    expect(response.status).toBe(429)
    expect(mocks.rateLimitResponse).toHaveBeenCalledWith(request)
    expect(mocks.revokeSessionById).not.toHaveBeenCalled()
  })

  it('requires an idempotency key before calling W02', async () => {
    const response = await DELETE(
      new Request('https://luckread.test/api/v1/auth/sessions/session-other', { method: 'DELETE' }),
      context(['session-other']),
    )

    expect(response.status).toBe(400)
    expect(mocks.revokeSessionById).not.toHaveBeenCalled()
  })
})
