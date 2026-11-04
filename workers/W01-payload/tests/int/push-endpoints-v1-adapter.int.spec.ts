import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import w05Worker from '../../../W05-social/src/index.js'
import {
  DELETE as deletePushEndpointRoute,
  PUT as putPushEndpointRoute,
} from '../../src/app/api/v1/push/endpoints/[installationId]/route.js'

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }))
vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 Expo push endpoint adapter', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/push/endpoints/[installationId]/route.ts'),
    'utf8',
  )

  it('resolves the current W02 principal and forwards only through the existing W01-to-W05 binding', () => {
    expect(route).toContain('resolveSocialPrincipal(request)')
    expect(route).toContain('callW05Social')
    expect(route).toContain("'/internal/social/push-endpoints/'")
    expect(route).toContain("method: 'PUT' | 'DELETE'")
    expect(route).not.toContain('getPayload(')
    expect(route).not.toContain('D1Database')
    expect(route).not.toContain('userId:')
  })

  it('applies the W01 write rate limit before principal resolution', () => {
    expect(route).toContain('await enforceW01WriteRateLimit(request)')
    expect(route).toContain('TrafficLimitError')
    expect(route).toContain('rateLimitResponse(request)')
    expect(route.indexOf('await enforceW01WriteRateLimit(request)'))
      .toBeLessThan(route.indexOf('await resolveSocialPrincipal(request)'))
  })

  it('exposes only idempotent PUT registration and owner-scoped DELETE, without returning tokens', () => {
    expect(route).toContain('export async function PUT')
    expect(route).toContain('export async function DELETE')
    expect(route).not.toContain('export async function POST')
    expect(route).toContain('body')
    expect(route).toContain('cache-control')
  })
})


describe('v1 Expo push endpoint W01-to-W05 integration', () => {
  const installationId = '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c'
  const token = 'ExponentPushToken[abcdefghijklmnop_1234567890]'

  const makeDatabase = () => {
    const writes: Array<{ sql: string; values: unknown[] }> = []
    const db = {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...values: unknown[]) => ({
          first: vi.fn(async () => {
            writes.push({ sql, values })
            return { endpoint_id: 'endpoint-integration-1', permission_status: 'granted' }
          }),
          run: vi.fn(async () => {
            writes.push({ sql, values })
            return { success: true, meta: { changes: 1 } }
          }),
        })),
      })),
    }
    return { db, writes }
  }

  const allowLimiter = () => ({
    limit: vi.fn(async () => ({ success: true })),
  })

  const setup = () => {
    const { db, writes } = makeDatabase()
    const limiter = allowLimiter()
    const w02Fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input)
      if (new URL(request.url).pathname !== '/internal/auth/principal') {
        return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 })
      }
      return Response.json({
        active: true,
        userId: 'session-owner-42',
        email: 'owner@example.test',
        layer: 'L2',
        roleAssignments: [],
      })
    })
    const w05Fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      return w05Worker.fetch(
        request,
        {
          D1_03: db,
          SOCIAL_WRITE_LIMITER: limiter,
          SOCIAL_ORIGIN_GLOBAL_LIMITER: limiter,
        } as never,
        {} as ExecutionContext,
      )
    })
    const env = {
      W02_AUTH: { fetch: w02Fetch },
      W05_SOCIAL: { fetch: w05Fetch },
      W01_WRITE_ORIGIN_GLOBAL_LIMITER: limiter,
      W01_WRITE_LIMITER: limiter,
      PUBLIC_ORIGIN_GLOBAL_LIMITER: limiter,
      PUBLIC_READ_LIMITER: limiter,
    }
    vi.mocked(getCloudflareContext).mockResolvedValue({ env } as never)
    return { db, writes, limiter, w02Fetch, w05Fetch }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the W02 session and writes the Expo endpoint through the real W05 Worker handler', async () => {
    const runtime = setup()
    const request = new Request('https://luckread.com/api/v1/push/endpoints/' + installationId, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer integration-session-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        platform: 'ios',
        permissionStatus: 'granted',
        expoPushToken: token,
        appVersion: '1.0.0',
      }),
    })

    const response = await putPushEndpointRoute(request, {
      params: Promise.resolve({ installationId }),
    })

    expect(response.status).toBe(200)
    const responseBody = await response.text()
    expect(responseBody).not.toContain(token)
    expect(JSON.parse(responseBody)).toMatchObject({
      data: { endpointId: 'endpoint-integration-1', status: 'ACTIVE' },
    })
    expect(runtime.w02Fetch).toHaveBeenCalledTimes(1)
    expect(runtime.w05Fetch).toHaveBeenCalledTimes(1)
    const forwarded = runtime.w05Fetch.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).pathname)
      .toBe('/internal/social/push-endpoints/' + installationId)
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('session-owner-42')
    expect(forwarded.headers.get('X-LuckRead-Principal-Layer')).toBe('L2')
    expect(runtime.writes).toHaveLength(1)
    expect(runtime.writes[0]?.sql).toContain('INSERT INTO notification_push_endpoints')
    expect(runtime.writes[0]?.values).toContain('session-owner-42')
    expect(runtime.writes[0]?.values).toContain(token)
  })

  it('deletes only the W02-authenticated owner installation through W05', async () => {
    const runtime = setup()
    const response = await deletePushEndpointRoute(
      new Request('https://luckread.com/api/v1/push/endpoints/' + installationId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer integration-session-token' },
      }),
      { params: Promise.resolve({ installationId }) },
    )

    expect(response.status).toBe(204)
    expect(runtime.writes).toHaveLength(1)
    expect(runtime.writes[0]?.sql)
      .toContain('DELETE FROM notification_push_endpoints WHERE owner_user_id = ? AND installation_id = ?')
    expect(runtime.writes[0]?.values).toEqual(['session-owner-42', installationId])
  })

  it('rejects a caller-supplied owner without persisting a push endpoint', async () => {
    const runtime = setup()
    const response = await putPushEndpointRoute(
      new Request('https://luckread.com/api/v1/push/endpoints/' + installationId, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer integration-session-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ownerUserId: 'attacker',
          platform: 'ios',
          permissionStatus: 'granted',
          expoPushToken: token,
        }),
      }),
      { params: Promise.resolve({ installationId }) },
    )

    expect(response.status).toBe(422)
    expect(runtime.writes).toHaveLength(0)
  })
})
