import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  proxyBetterAuth: vi.fn(),
  revokeSessionById: vi.fn(),
  enforcePublicReadRateLimit: vi.fn(),
  enforceW01WriteRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('rate limited', { status: 429 })),
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  proxyBetterAuth: mocks.proxyBetterAuth,
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

const context = (segments: string[] = []) => ({ params: Promise.resolve({ segments }) })
const session = (id: string, createdAt: string) => ({
  id,
  createdAt,
  expiresAt: '2026-12-01T00:00:00.000Z',
  userId: 'owner-user',
  token: 'must-not-be-returned',
})

const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const cursorId = (value: string): string => {
  const encoded = value.slice(3).replace(/-/g, '+').replace(/_/g, '/')
  return atob(encoded + '='.repeat((4 - encoded.length % 4) % 4))
}

describe('session management route behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.proxyBetterAuth.mockReset()
    mocks.revokeSessionById.mockReset()
    mocks.enforcePublicReadRateLimit.mockResolvedValue(undefined)
    mocks.enforceW01WriteRateLimit.mockResolvedValue(undefined)
    mocks.revokeSessionById.mockResolvedValue(undefined)
  })

  it('returns the current session at the envelope and excludes secrets from session items', async () => {
    mocks.proxyBetterAuth
      .mockResolvedValueOnce(jsonResponse([
        session('session-3', '2026-10-03T00:00:00.000Z'),
        session('session-2', '2026-10-02T00:00:00.000Z'),
        session('session-1', '2026-10-01T00:00:00.000Z'),
      ]))
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'session-2' } }))

    const response = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?limit=2', {
        headers: { cookie: 'better-auth.session_token=test' },
      }),
      context(),
    )
    const payload = await response.json() as {
      items: Array<Record<string, unknown>>
      currentSessionId: string
      nextCursor: string | null
    }

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload.currentSessionId).toBe('session-2')
    expect(payload.items.map((item) => item.sessionId)).toEqual(['session-3', 'session-2'])
    expect(payload.items.every((item) => !('token' in item) && !('userId' in item))).toBe(true)
    expect(payload.nextCursor).toMatch(/^s1\.[A-Za-z0-9_-]+$/)
    expect(cursorId(payload.nextCursor as string)).toBe('session-2')
    expect(mocks.enforcePublicReadRateLimit).toHaveBeenCalledTimes(1)
  })

  it('continues from the opaque cursor without repeating previous items', async () => {
    const cursor = 's1.' + btoa('session-2').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    mocks.proxyBetterAuth
      .mockResolvedValueOnce(jsonResponse([
        session('session-3', '2026-10-03T00:00:00.000Z'),
        session('session-2', '2026-10-02T00:00:00.000Z'),
        session('session-1', '2026-10-01T00:00:00.000Z'),
      ]))
      .mockResolvedValueOnce(jsonResponse({ session: { id: 'session-3' } }))

    const response = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?limit=2&cursor=' + encodeURIComponent(cursor)),
      context(),
    )
    const payload = await response.json() as { items: Array<{ sessionId: string }>; nextCursor: string | null }

    expect(response.status).toBe(200)
    expect(payload.items.map((item) => item.sessionId)).toEqual(['session-1'])
    expect(payload.nextCursor).toBeNull()
  })

  it('rejects invalid limit and malformed cursor before calling Better Auth', async () => {
    const invalidLimit = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?limit=101'),
      context(),
    )
    expect(invalidLimit.status).toBe(400)
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()

    const invalidCursor = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions?cursor=not-a-cursor'),
      context(),
    )
    expect(invalidCursor.status).toBe(400)
    expect(mocks.proxyBetterAuth).not.toHaveBeenCalled()
  })

  it('fails closed if the active session cannot be identified', async () => {
    mocks.proxyBetterAuth
      .mockResolvedValueOnce(jsonResponse([session('session-1', '2026-10-01T00:00:00.000Z')]))
      .mockResolvedValueOnce(jsonResponse({ session: {} }))

    const response = await GET(
      new Request('https://luckread.test/api/v1/auth/sessions'),
      context(),
    )
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('SERVICE_UNAVAILABLE')
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

  it('requires an idempotency key before calling W02', async () => {
    const response = await DELETE(
      new Request('https://luckread.test/api/v1/auth/sessions/session-other', { method: 'DELETE' }),
      context(['session-other']),
    )

    expect(response.status).toBe(400)
    expect(mocks.revokeSessionById).not.toHaveBeenCalled()
  })
})
