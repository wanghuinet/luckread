import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  w02Fetch: vi.fn(),
  limiter: { limit: vi.fn() },
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

import { GET } from '../../src/app/api/v1/auth/mfa/route.js'

describe('W01 public MFA status route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.limiter.limit.mockResolvedValue({ success: true })
    mocks.w02Fetch.mockResolvedValue(Response.json({
      data: { enabled: true, verified: true, enrolledAt: '2026-10-24T11:00:00.000Z' },
    }))
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        AUTH_REFRESH_LIMITER: mocks.limiter,
        W02_AUTH: { fetch: mocks.w02Fetch },
      },
    })
  })

  it('forwards the caller session through W02_AUTH and returns only the no-store status projection', async () => {
    const response = await GET(new Request('https://api.luckread.com/v1/auth/mfa', {
      headers: {
        cookie: 'better-auth.session_token=opaque-session',
        'cf-connecting-ip': '203.0.113.10',
      },
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({
      data: {
        enabled: true,
        verified: true,
        enrolledAt: '2026-10-24T11:00:00.000Z',
      },
    })
    expect(mocks.limiter.limit).toHaveBeenCalledWith({
      key: 'AUTH_REFRESH_LIMITER:ip:203.0.113.10',
    })
    expect(mocks.w02Fetch).toHaveBeenCalledTimes(1)
    const forwarded = mocks.w02Fetch.mock.calls[0]?.[0] as Request
    expect(forwarded.url).toBe('https://luckread-w02.internal/internal/auth/mfa/status')
    expect(forwarded.method).toBe('POST')
    expect(forwarded.headers.get('cookie')).toBe('better-auth.session_token=opaque-session')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded.headers.get('X-LuckRead-Transport-Version')).toBe('1.0')
    expect(JSON.stringify(await response.clone().json())).not.toMatch(/secret|backupCodes|lockedUntil|failedVerificationCount/i)
  })

  it('maps an unauthenticated W02 session to 401 without inventing a disabled status', async () => {
    mocks.w02Fetch.mockResolvedValueOnce(Response.json(
      { error: { code: 'UNAUTHENTICATED' } },
      { status: 401 },
    ))
    const response = await GET(new Request('https://api.luckread.com/v1/auth/mfa'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    })
  })

  it('fails closed when W02 or its gated MFA schema is unavailable', async () => {
    mocks.w02Fetch.mockResolvedValueOnce(Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE' } },
      { status: 503 },
    ))
    const response = await GET(new Request('https://api.luckread.com/v1/auth/mfa'))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_UNAVAILABLE' },
    })
  })

  it('does not continue when the rate-limit binding fails', async () => {
    mocks.limiter.limit.mockRejectedValueOnce(new Error('binding unavailable'))
    const response = await GET(new Request('https://api.luckread.com/v1/auth/mfa'))
    expect(response.status).toBe(503)
    expect(mocks.w02Fetch).not.toHaveBeenCalled()
  })
})
