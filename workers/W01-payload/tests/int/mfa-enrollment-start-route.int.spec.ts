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

const makeRequest = (body: unknown = { currentPassword: 'correct horse battery staple' }, key = 'mfa-enroll-key-0001') =>
  new Request('https://api.luckread.com/v1/auth/mfa/enrollment', {
    method: 'POST',
    headers: {
      cookie: 'better-auth.session_token=opaque-session',
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.10',
      ...(key ? { 'Idempotency-Key': key } : {}),
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
    mocks.w02Fetch.mockResolvedValue(Response.json({
      data: {
        totpUri: 'otpauth://totp/LuckRead:user%40example.com?secret=ABCDEFGHIJKLMNOP&issuer=LuckRead',
        recoveryCodes: ['RECOVERY-ONE', 'RECOVERY-TWO'],
      },
    }))
  })

  it('performs one W01 -> W02 call and returns the canonical one-time DTO', async () => {
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
    expect(mocks.w02Fetch).toHaveBeenCalledTimes(1)
    const forwarded = mocks.w02Fetch.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).pathname).toBe('/internal/auth/mfa/enrollment/start')
    expect(forwarded.method).toBe('POST')
    expect(forwarded.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded.headers.get('X-LuckRead-Transport-Version')).toBe('1.0')
    expect(forwarded.headers.get('Idempotency-Key')).toBe('mfa-enroll-key-0001')
    await expect(forwarded.json()).resolves.toEqual({ currentPassword: 'correct horse battery staple' })
    expect(mocks.globalLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:origin' })
    expect(mocks.writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:ip:203.0.113.10' })
    expect(mocks.writeLimiter.limit).toHaveBeenCalledWith({ key: 'w01-write:endpoint:authMfaEnrollmentStart' })
  })

  it('rejects missing idempotency keys and unexpected request fields before contacting W02', async () => {
    const missingKey = await POST(makeRequest({ currentPassword: 'correct horse battery staple' }, ''))
    expect(missingKey.status).toBe(400)
    await expect(missingKey.json()).resolves.toMatchObject({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED' } })

    const extraField = await POST(makeRequest({ currentPassword: 'correct horse battery staple', userId: 'someone-else' }))
    expect(extraField.status).toBe(422)
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })

  it('maps existing pending factor conflicts without exposing identity service details', async () => {
    mocks.w02Fetch.mockResolvedValueOnce(Response.json({ error: { code: 'MFA_ENROLLMENT_CONFLICT' } }, { status: 409 }))
    const response = await POST(makeRequest())
    expect(response.status).toBe(409)
    expect(await response.text()).not.toContain('MFA_ENROLLMENT_CONFLICT')
  })

  it('fails closed on exhausted rate limit or malformed identity-service output', async () => {
    mocks.globalLimiter.limit.mockResolvedValueOnce({ success: false })
    const throttled = await POST(makeRequest())
    expect(throttled.status).toBe(429)
    expect(mocks.w02Fetch).not.toHaveBeenCalled()

    mocks.globalLimiter.limit.mockResolvedValue({ success: true })
    mocks.w02Fetch.mockResolvedValueOnce(Response.json({ data: { totpUri: 'not-uri', recoveryCodes: [] } }))
    const malformed = await POST(makeRequest())
    expect(malformed.status).toBe(503)
  })
})
