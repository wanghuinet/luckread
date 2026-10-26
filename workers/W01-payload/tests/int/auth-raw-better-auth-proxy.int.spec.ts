import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
  w02Fetch: vi.fn(),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mocks.getCloudflareContext,
}))

vi.mock('@/auth/traffic-limit', () => ({
  enforceAuthRateLimit: vi.fn(),
  TrafficLimitError: class extends Error {},
  rateLimitResponse: vi.fn(),
}))

import {
  GET,
  POST,
} from '../../src/app/api/auth/[...segments]/route.js'

const rawEndpoints = [
  { method: 'POST' as const, endpoint: 'two-factor/disable' },
  { method: 'POST' as const, endpoint: 'two-factor/generate-backup-codes' },
  { method: 'POST' as const, endpoint: 'two-factor/verify-totp' },
  { method: 'POST' as const, endpoint: 'two-factor/verify-backup-code' },
  { method: 'POST' as const, endpoint: 'two-factor/enable' },
  { method: 'GET' as const, endpoint: 'two-factor/get-totp-uri' },
  { method: 'POST' as const, endpoint: 'sign-in/email' },
  { method: 'GET' as const, endpoint: 'get-session' },
  { method: 'POST' as const, endpoint: 'sign-up/email' },
  { method: 'POST' as const, endpoint: 'an-unapproved-endpoint' },
]

describe('W01 raw Better Auth proxy boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCloudflareContext.mockResolvedValue({
      env: {
        W02_AUTH: {
          fetch: mocks.w02Fetch,
        },
      },
    })
    mocks.w02Fetch.mockResolvedValue(
      Response.json(
        { token: 'must-never-be-returned', user: { id: 'user-1' } },
        { headers: { 'set-auth-token': 'must-never-be-forwarded' } },
      ),
    )
  })

  it.each(rawEndpoints)(
    'fails closed for raw endpoint $endpoint ($method)',
    async ({ method, endpoint }) => {
      const request = new Request(`https://luckread.test/api/auth/${endpoint}`, {
        method,
        headers: {
          cookie: 'better-auth.session_token=attacker-controlled-session',
          authorization: 'Bearer attacker-controlled-token',
          'content-type': 'application/json',
        },
        ...(method === 'GET'
          ? {}
          : {
              body: JSON.stringify({
                currentPassword: 'must-not-be-used',
                password: 'must-not-be-used',
                code: '123456',
              }),
            }),
      })

      const response = await (method === 'GET' ? GET : POST)(request, {
        params: Promise.resolve({ segments: endpoint.split('/') }),
      })

      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const responseBody = await response.text()
      expect(responseBody).toContain('"code":"NOT_FOUND"')
      expect(responseBody).not.toContain('must-never-be-returned')
      expect(responseBody).not.toContain('must-never-be-forwarded')
      expect(responseBody).not.toContain('attacker-controlled-token')
      expect(mocks.getCloudflareContext).not.toHaveBeenCalled()
      expect(mocks.w02Fetch).not.toHaveBeenCalled()
    },
  )
})
