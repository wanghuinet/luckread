// @vitest-environment node

import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const bridge = vi.hoisted(() => ({
  w05Fetch: vi.fn(),
  resolvePrincipal: vi.fn(),
  authorize: vi.fn(),
  audit: vi.fn(),
  edgeLimit: vi.fn(),
  accountLimit: vi.fn(),
  endpointLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  MockTrafficLimitError: class MockTrafficLimitError extends Error {},
  MockW08CreatorClientError: class MockW08CreatorClientError extends Error {},
  MockW06ModerationClientError: class MockW06ModerationClientError extends Error {},
}))

// Keep the real W01 W05 client and its transport-header/response-relay code.
// Only the platform-provided binding lookup is substituted so it points at the
// actual W05 Worker fetch entrypoint inside this local integration test.
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: async () => ({
    env: {
      W05_SOCIAL: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => bridge.w05Fetch(input, init),
      },
    },
  }),
}))

vi.mock('../../W01-payload/src/social/w05-social-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../W01-payload/src/social/w05-social-client.js')>()
  return {
    ...actual,
    resolveSocialPrincipal: bridge.resolvePrincipal,
  }
})

vi.mock('../../W01-payload/src/auth/w08-creator-client.js', () => ({
  callW08Creator: bridge.authorize,
  W08CreatorClientError: bridge.MockW08CreatorClientError,
}))

vi.mock('../../W01-payload/src/moderation/w06-moderation-client.js', () => ({
  callW06PushEndpointMutationAudit: bridge.audit,
  W06ModerationClientError: bridge.MockW06ModerationClientError,
}))

vi.mock('../../W01-payload/src/auth/traffic-limit.js', () => ({
  TrafficLimitError: bridge.MockTrafficLimitError,
  enforceW01WriteRateLimit: bridge.edgeLimit,
  enforceW01WriteAccountRateLimit: bridge.accountLimit,
  enforceW01WriteEndpointRateLimit: bridge.endpointLimit,
  rateLimitResponse: bridge.rateLimitResponse,
}))

import w05Worker from './index.js'
import { DELETE, PUT } from '../../W01-payload/src/app/api/v1/push/endpoints/[installationId]/route.js'

const installationId = '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c'
const token = 'ExponentPushToken[abcdefghijklmnop_1234567890]'
const principal = { userId: 'w02-user-0001', layer: 'L2', verified: true }
const context = { params: Promise.resolve({ installationId }) }

function createD1Sqlite() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(
    new URL('../../W09-platform/migrations-d1-03/0001_notification_push_endpoints.sql', import.meta.url),
    'utf8',
  ))

  const db = {
    prepare(sql: string) {
      const statement = sqlite.prepare(sql)
      let values: unknown[] = []
      const bound = {
        bind(...next: unknown[]) {
          values = next
          return bound
        },
        async first<T>() {
          return (statement.get(...values as (string | number | null)[]) as T | undefined) ?? null
        },
        async run() {
          const result = statement.run(...values as (string | number | null)[])
          return { success: true, meta: { changes: Number(result.changes) } }
        },
        async all<T>() {
          return { results: statement.all(...values as (string | number | null)[]) as T[] }
        },
      }
      return bound
    },
  } as unknown as D1Database

  return { db, sqlite, close: () => sqlite.close() }
}

let d1: ReturnType<typeof createD1Sqlite>

const requestFor = (method: 'PUT' | 'DELETE', body?: unknown, key = 'idem_w05_binding_0001') =>
  new Request('https://www.luckread.com/api/v1/push/endpoints/' + installationId, {
    method,
    headers: {
      Authorization: 'Bearer integration-test-session',
      'Idempotency-Key': key,
      ...(method === 'PUT' ? { 'content-type': 'application/json' } : {}),
    },
    ...(method === 'PUT' ? { body: JSON.stringify(body) } : {}),
  })

describe('W01 to W05 push endpoint service-binding integration', () => {
  beforeEach(() => {
    d1 = createD1Sqlite()
    vi.clearAllMocks()
    bridge.resolvePrincipal.mockResolvedValue(principal)
    bridge.authorize.mockImplementation(async (request: Request) => {
      const body = await request.clone().json() as Record<string, unknown>
      return Response.json({
        decision: 'ALLOW',
        action: body.action,
        resourceType: body.resourceType,
        policyVersion: 'casl-l0-l8-v1',
        layer: 'L2',
      })
    })
    bridge.audit.mockImplementation(async (input: { body: {
      eventId: string
      installationId: string
    } }) => Response.json({
      eventId: input.body.eventId,
      action: 'notification.push_endpoint.mutation_requested',
      targetType: 'NotificationPushEndpoint',
      targetId: input.body.installationId,
      replayed: false,
    }, { status: 201 }))
    bridge.edgeLimit.mockResolvedValue(undefined)
    bridge.accountLimit.mockResolvedValue(undefined)
    bridge.endpointLimit.mockResolvedValue(undefined)
    bridge.rateLimitResponse.mockImplementation(() =>
      Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429 }),
    )
    bridge.w05Fetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const runtime = w05Worker as unknown as {
        fetch(request: Request, env: unknown): Promise<Response>
      }
      return runtime.fetch(request, { DB: d1.db, D1_03: d1.db })
    })
  })

  afterEach(() => {
    d1.close()
  })

  it('executes the real W01 route and W05 Worker, persisting an Expo endpoint in SQLite D1-03', async () => {
    const response = await PUT(requestFor('PUT', {
      platform: 'android',
      permissionStatus: 'granted',
      expoPushToken: token,
      appVersion: '1.0.0',
    }), context)

    expect(response.status).toBe(200)
    const responseBody = await response.json() as { data: { endpointId: string; status: string } }
    expect(responseBody.data).toMatchObject({ status: 'ACTIVE' })
    expect(responseBody.data.endpointId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(JSON.stringify(responseBody)).not.toContain(token)

    expect(bridge.w05Fetch).toHaveBeenCalledTimes(1)
    const forwarded = bridge.w05Fetch.mock.calls[0]?.[0] as Request
    expect(new URL(forwarded.url).pathname).toBe('/internal/social/push-endpoints/' + installationId)
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded.headers.get('X-LuckRead-Transport-Version')).toBe('1.0')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe(principal.userId)
    expect(forwarded.headers.get('X-LuckRead-Principal-Layer')).toBe('L2')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)

    const stored = d1.sqlite.prepare(
      'SELECT endpoint_id, installation_id, owner_user_id, provider, platform, push_token, permission_status FROM notification_push_endpoints WHERE installation_id = ?',
    ).get(installationId) as Record<string, string>
    expect(stored).toMatchObject({
      endpoint_id: responseBody.data.endpointId,
      installation_id: installationId,
      owner_user_id: principal.userId,
      provider: 'expo',
      platform: 'android',
      push_token: token,
      permission_status: 'granted',
    })
  })

  it('uses the real W05 owner predicate and cannot let a second account claim an installation', async () => {
    const first = await PUT(requestFor('PUT', {
      platform: 'ios', permissionStatus: 'granted', expoPushToken: token,
    }, 'idem_owner_first_0001'), context)
    expect(first.status).toBe(200)

    bridge.resolvePrincipal.mockResolvedValueOnce({
      userId: 'w02-user-0002', layer: 'L2', verified: true,
    })
    const second = await PUT(requestFor('PUT', {
      platform: 'ios',
      permissionStatus: 'granted',
      expoPushToken: 'ExponentPushToken[second_user_token_1234567890]',
    }, 'idem_owner_second_0002'), context)

    expect(second.status).toBe(409)
    const stored = d1.sqlite.prepare(
      'SELECT owner_user_id, push_token FROM notification_push_endpoints WHERE installation_id = ?',
    ).get(installationId) as { owner_user_id: string; push_token: string }
    expect(stored).toEqual({ owner_user_id: principal.userId, push_token: token })
  })

  it('clears the actual D1-03 token when the authenticated user denies notification permission', async () => {
    const first = await PUT(requestFor('PUT', {
      platform: 'android', permissionStatus: 'granted', expoPushToken: token,
    }, 'idem_enable_device_0001'), context)
    expect(first.status).toBe(200)

    const disabled = await PUT(requestFor('PUT', {
      platform: 'android', permissionStatus: 'denied', expoPushToken: null,
    }, 'idem_disable_device_0002'), context)
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toMatchObject({ data: { status: 'DISABLED' } })

    const stored = d1.sqlite.prepare(
      'SELECT permission_status, push_token FROM notification_push_endpoints WHERE installation_id = ?',
    ).get(installationId) as { permission_status: string; push_token: string | null }
    expect(stored).toEqual({ permission_status: 'denied', push_token: null })
  })

  it('routes authenticated deletion through W05 and removes only the current owner row', async () => {
    const registered = await PUT(requestFor('PUT', {
      platform: 'ios', permissionStatus: 'granted', expoPushToken: token,
    }, 'idem_register_for_delete_0001'), context)
    expect(registered.status).toBe(200)

    bridge.resolvePrincipal.mockResolvedValueOnce({
      userId: 'w02-user-0002', layer: 'L2', verified: true,
    })
    const otherOwnerDelete = await DELETE(requestFor('DELETE', undefined, 'idem_wrong_owner_delete_0002'), context)
    expect(otherOwnerDelete.status).toBe(204)
    expect(d1.sqlite.prepare('SELECT endpoint_id FROM notification_push_endpoints WHERE installation_id = ?')
      .get(installationId)).toBeTruthy()

    const ownerDelete = await DELETE(requestFor('DELETE', undefined, 'idem_right_owner_delete_0003'), context)
    expect(ownerDelete.status).toBe(204)
    expect(d1.sqlite.prepare('SELECT endpoint_id FROM notification_push_endpoints WHERE installation_id = ?')
      .get(installationId)).toBeUndefined()
  })

  it('records the authorization and audit order before touching the W05 service boundary', async () => {
    const response = await PUT(requestFor('PUT', {
      platform: 'android', permissionStatus: 'granted', expoPushToken: token,
    }), context)
    expect(response.status).toBe(200)
    expect(bridge.authorize).toHaveBeenCalledTimes(1)
    expect(bridge.audit).toHaveBeenCalledTimes(1)
    expect(bridge.w05Fetch).toHaveBeenCalledTimes(1)
    expect(bridge.authorize.mock.invocationCallOrder[0]).toBeLessThan(bridge.audit.mock.invocationCallOrder[0])
    expect(bridge.audit.mock.invocationCallOrder[0]).toBeLessThan(bridge.w05Fetch.mock.invocationCallOrder[0])
  })
})
