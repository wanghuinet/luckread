import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  w02Fetch: vi.fn(),
  globalLimiter: { limit: vi.fn() },
  writeLimiter: { limit: vi.fn() },
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

import { POST } from '../../src/app/api/v1/auth/mfa/enrollment/route.js'

const principalResponse = () => Response.json({
  active: true,
  userId: 'user-12345678',
  email: 'user@example.com',
  accountState: 'ACTIVE',
})

const enrollmentResponse = () => Response.json({
  method: 'totp',
  totpURI: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
  backupCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
})

const makeRequest = (body: unknown = { currentPassword: 'correct horse battery staple' }) =>
  new Request('https://api.luckread.com/v1/auth/mfa/enrollment', {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
    },
    body: JSON.stringify(body),
  })

describe('W01 public MFA enrollment-start route', () => {
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
      if (new URL(request.url).pathname === '/internal/auth/principal') return principalResponse()
      if (new URL(request.url).pathname === '/api/auth/two-factor/enable') return enrollmentResponse()
      return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
    })
  })

  it('forwards password reauthentication to W02 and returns only the canonical one-time DTO', async () => {
    const response = await POST(makeRequest())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const payload = await response.json() as { data?: Record<string, unknown> }
    expect(payload.data).toEqual({
      totpUri: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
      recoveryCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
    })
    expect(JSON.stringify(payload)).not.toContain('backupCodes')
    expect(JSON.stringify(payload)).not.toContain('correct horse battery staple')

    expect(mocks.w02Fetch).toHaveBeenCalledTimes(2)
    const calls = mocks.w02Fetch.mock.calls.map((call) => call[0] as Request)
    const authCall = calls.find((request) => new URL(request.url).pathname === '/api/auth/two-factor/enable')
    expect(authCall).toBeDefined()
    expect(authCall?.method).toBe('POST')
    expect(authCall?.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    await expect(authCall?.json()).resolves.toEqual({
      password: 'correct horse battery staple',
      method: 'totp',
    })
    expect(mocks.globalLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:origin' })
    expect(mocks.writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:ip:203.0.113.10' })
    expect(mocks.writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:account:user-12345678' })
    expect(mocks.writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:endpoint:authMfaEnrollmentStart' })
  })

  it('validates the request before contacting the identity service', async () => {
    const response = await POST(makeRequest({ currentPassword: '   ' }))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    })
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })

  it('requires an authenticated active account before enrollment', async () => {
    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (new URL(request.url).pathname === '/internal/auth/principal') {
        return Response.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 })
      }
      return enrollmentResponse()
    })
    const response = await POST(makeRequest())
    expect(response.status).toBe(401)
    expect(mocks.w02Fetch).toHaveBeenCalledTimes(1)
  })

  it('denies non-active accounts without calling the factor mutation endpoint', async () => {
    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (new URL(request.url).pathname === '/internal/auth/principal') {
        return Response.json({ active: true, userId: 'user-12345678', email: 'user@example.com', accountState: 'SUSPENDED' })
      }
      return enrollmentResponse()
    })
    const response = await POST(makeRequest())
    expect(response.status).toBe(403)
    expect(mocks.w02Fetch).toHaveBeenCalledTimes(1)
  })

  it('does not expose raw Better Auth errors when enrollment is rejected', async () => {
    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (new URL(request.url).pathname === '/internal/auth/principal') return principalResponse()
      return Response.json({ message: 'secret internal adapter details', code: 'TOTP_ALREADY_ENABLED' }, { status: 400 })
    })
    const response = await POST(makeRequest())
    expect(response.status).toBe(400)
    const payload = await response.text()
    expect(payload).not.toContain('secret internal adapter details')
    expect(payload).not.toContain('TOTP_ALREADY_ENABLED')
    expect(payload).toContain('MFA_ENROLLMENT_REJECTED')
  })

  it('fails closed if the rate-limit provider is unavailable or exhausted', async () => {
    mocks.globalLimiter.limit.mockResolvedValueOnce({ success: false })
    const response = await POST(makeRequest())
    expect(response.status).toBe(429)
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })

  it('rejects malformed enrollment results rather than issuing an ambiguous DTO', async () => {
    mocks.w02Fetch.mockImplementation(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (new URL(request.url).pathname === '/internal/auth/principal') return principalResponse()
      return Response.json({ method: 'totp', totpURI: 'not-an-otpauth-uri', backupCodes: [] })
    })
    const response = await POST(makeRequest())
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
