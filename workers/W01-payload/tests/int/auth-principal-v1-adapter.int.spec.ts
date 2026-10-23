import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBetterAuthPrincipal: vi.fn(),
  enforceAuthRateLimit: vi.fn(),
  W02AuthClientError: class extends Error {
    status: number
    constructor(status: number) {
      super('authentication failed')
      this.status = status
    }
  },
}))

vi.mock('../../src/auth/w02-session-client.js', () => ({
  getBetterAuthPrincipal: mocks.getBetterAuthPrincipal,
  W02AuthClientError: mocks.W02AuthClientError,
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  enforceAuthRateLimit: mocks.enforceAuthRateLimit,
  TrafficLimitError: class extends Error {},
  rateLimitResponse: vi.fn(() => Response.json(
    { error: { code: 'RATE_LIMITED', message: 'Too many requests', details: {} }, requestId: 'req-test' },
    { status: 429 },
  )),
}))

import { GET } from '../../src/app/api/v1/auth/principal/route.js'

const request = () => new Request('https://api.luckread.test/v1/auth/principal', {
  method: 'GET',
  headers: {
    cookie: 'better-auth.session_token=test',
    'cf-connecting-ip': '203.0.113.10',
  },
})

describe('W01 public auth principal API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.enforceAuthRateLimit.mockResolvedValue(undefined)
  })

  it('returns only the public identity and authorization fields through W01', async () => {
    mocks.getBetterAuthPrincipal.mockResolvedValue({
      active: true,
      userId: 'user-123',
      email: 'creator@example.com',
      username: 'creator',
      layer: 'L3',
      sessionId: 'private-session-id',
      roleAssignments: [{ id: 'private-role-assignment' }],
    })

    const response = await GET(request())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(payload.data).toEqual({
      active: true,
      userId: 'user-123',
      email: 'creator@example.com',
      username: 'creator',
      layer: 'L3',
    })
    expect(JSON.stringify(payload)).not.toContain('private-session-id')
    expect(JSON.stringify(payload)).not.toContain('private-role-assignment')
    expect(mocks.getBetterAuthPrincipal).toHaveBeenCalledWith(expect.any(Request))
    expect(mocks.enforceAuthRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      'AUTH_REFRESH_LIMITER',
      ['ip:203.0.113.10'],
    )
  })

  it('normalizes unauthenticated and unavailable W02 responses', async () => {
    mocks.getBetterAuthPrincipal.mockRejectedValueOnce(new mocks.W02AuthClientError(401))
    const unauthenticated = await GET(request())
    expect(unauthenticated.status).toBe(401)
    expect((await unauthenticated.json()).error.code).toBe('UNAUTHENTICATED')

    mocks.getBetterAuthPrincipal.mockRejectedValueOnce(new Error('binding unavailable'))
    const unavailable = await GET(request())
    expect(unavailable.status).toBe(503)
    expect((await unavailable.json()).error.code).toBe('SERVICE_UNAVAILABLE')
  })

  it('uses the locked public API contract and keeps the creator page off private W02 service clients', () => {
    const workerRoot = existsWorkerRoot()
    const page = readFileSync(resolve(workerRoot, 'src/app/(frontend)/creator-center/page.tsx'), 'utf8')
    const openapi = readFileSync(resolve(workerRoot, '../../contracts/openapi/v1/openapi.yaml'), 'utf8')

    expect(page).toContain("'https://api.luckread.com'")
    expect(page).toContain("'/v1/auth/principal'")
    expect(page).toContain('fetchJson<AuthPrincipalResponse>')
    expect(page).not.toContain('getBetterAuthPrincipal')
    expect(page).not.toContain('W02AuthClientError')
    expect(page).not.toContain('.internal')
    expect(openapi).toContain('  /auth/principal:')
    expect(openapi).toContain('operationId: authPrincipalGet')
  })
})

function existsWorkerRoot() {
  const localPage = resolve(process.cwd(), 'src/app/(frontend)/creator-center/page.tsx')
  return requireExists(localPage) ? process.cwd() : resolve(process.cwd(), 'workers/W01-payload')
}

function requireExists(path: string) {
  try {
    readFileSync(path, 'utf8')
    return true
  } catch {
    return false
  }
}
