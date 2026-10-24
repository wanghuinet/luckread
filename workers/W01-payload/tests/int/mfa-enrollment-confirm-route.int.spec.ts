import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  w02Fetch: vi.fn(),
  globalLimiter: { limit: vi.fn() },
  writeLimiter: { limit: vi.fn() },
}))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: mocks.getCloudflareContext }))

import { POST } from '../../src/app/api/v1/auth/mfa/enrollment/confirm/route.js'

const makeRequest = (body: unknown = { code: '123456' }, key = 'mfa-confirm-key-0001') => new Request(
  'https://api.luckread.com/v1/auth/mfa/enrollment/confirm',
  {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  },
)

describe('W01 public MFA enrollment-confirm route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.globalLimiter.limit.mockResolvedValue({ success: true })
    mocks.writeLimiter.limit.mockResolvedValue({ success: true })
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        W01_WRITE_ORIGIN_GLOBAL_LIMITER: mocks.globalLimiter,
        W01_WRITE_LIMITER: mocks.writeLimiter,
        W02_AUTH: { fetch: mocks.w02Fetch },
      },
    })
    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      const path = new URL(request.url).pathname
      if (path === '/internal/auth/principal') {
        return Response.json({
          active: true, userId: 'user-12345678', email: 'user@example.com', accountState: 'ACTIVE',
        })
      }
      if (path === '/internal/auth/mfa/enrollment/confirm') {
        return Response.json({
          data: { enabled: true, verified: true, enrolledAt: '2026-10-24T12:00:00.000Z' },
        })
      }
      return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    })
  })

  it('uses W02 as factor authority and returns a no-store status DTO', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: { enabled: true, verified: true, enrolledAt: '2026-10-24T12:00:00.000Z' },
    })
    const requests = mocks.w02Fetch.mock.calls.map((call) => call[0] as Request)
    expect(requests.some((request) => new URL(request.url).pathname === '/internal/auth/mfa/enrollment/confirm')).toBe(true)
    const confirm = requests.find((request) => new URL(request.url).pathname === '/internal/auth/mfa/enrollment/confirm')
    expect(confirm?.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(confirm?.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    expect(confirm?.headers.get('Idempotency-Key')).toBe('mfa-confirm-key-0001')
    await expect(confirm?.json()).resolves.toEqual({ code: '123456' })
    expect(mocks.writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:endpoint:authMfaEnrollmentConfirm' })
  })

  it('requires Idempotency-Key before contacting W02', async () => {
    const response = await POST(makeRequest({ code: '123456' }, ''))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } })
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed codes before account lookup or factor mutation', async () => {
    const response = await POST(makeRequest({ code: 'abc123', userId: 'someone-else' }))
    expect(response.status).toBe(422)
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })

  it('requires the authenticated ACTIVE principal and maps W02 failures safely', async () => {
    mocks.w02Fetch.mockImplementationOnce(async () => Response.json(
      { error: { code: 'UNAUTHENTICATED' } }, { status: 401 },
    ))
    const noSession = await POST(makeRequest())
    expect(noSession.status).toBe(401)

    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(input)
      if (new URL(req.url).pathname === '/internal/auth/principal') {
        return Response.json({ active: true, userId: 'user-12345678', email: 'user@example.com', accountState: 'ACTIVE' })
      }
      return Response.json({ error: { code: 'MFA_CODE_INVALID', message: 'secret details' } }, { status: 401 })
    })
    const failed = await POST(makeRequest())
    expect(failed.status).toBe(401)
    expect(await failed.text()).not.toContain('secret details')
  })
})
