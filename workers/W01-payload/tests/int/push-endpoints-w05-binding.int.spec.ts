// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  requests: [] as Request[],
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(async () => ({ env: runtime.env })),
}))
vi.mock('payload', () => ({ getPayload: vi.fn() }))
vi.mock('@payload-config', () => ({ default: {} }))

import { callW05Social } from '../../src/social/w05-social-client.js'
import w05Worker from '../../../W05-social/src/index.js'

const installationId = '6b6d9f5a-4e61-4c50-9d17-9e97f36e6e3c'
const token = 'ExponentPushToken[abcdefghijklmnop_1234567890]'
const context = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext

function fakeD1(permissionStatus = 'granted') {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...values: unknown[]) => {
      calls.push({ sql, values })
      return {
        first: vi.fn(async () => ({ endpoint_id: 'endpoint-1', permission_status: permissionStatus })),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      }
    }),
  }))
  return {
    database: { prepare } as unknown as D1Database,
    prepare,
    calls,
  }
}

function connectW05(d1_02 = fakeD1(), d1_03 = fakeD1()) {
  runtime.requests.length = 0
  const service = {
    fetch: vi.fn(async (request: Request) => {
      runtime.requests.push(request.clone())
      return w05Worker.fetch(
        request,
        { DB: d1_02.database, D1_03: d1_03.database } as never,
        context,
      )
    }),
  }
  runtime.env = { W05_SOCIAL: service }
  return { service, d1_02, d1_03 }
}

const publicRequest = (method: 'PUT' | 'DELETE') =>
  new Request('https://www.luckread.com/api/v1/push/endpoints/' + installationId, {
    method,
    headers: { 'X-LuckRead-Correlation-Id': 'w01-push-binding-integration' },
  })

const principal = { userId: 'user_test_01', layer: 'L2', verified: true }

beforeEach(() => {
  runtime.env = {}
  runtime.requests.length = 0
})

describe('W01 → W05 Expo push endpoint Service Binding integration', () => {
  it('forwards the trusted W01 principal and registers in W09-owned D1-03 runtime state', async () => {
    const { service, d1_02, d1_03 } = connectW05()
    const response = await callW05Social({
      request: publicRequest('PUT'),
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'PUT',
      principal,
      body: {
        platform: 'android',
        permissionStatus: 'granted',
        expoPushToken: token,
        appVersion: '1.0.0',
      },
    })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('endpoint-1')
    expect(text).not.toContain(token)
    expect(service.fetch).toHaveBeenCalledTimes(1)
    expect(runtime.requests[0]?.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(runtime.requests[0]?.headers.get('X-LuckRead-Principal-User-Id')).toBe('user_test_01')
    expect(runtime.requests[0]?.headers.get('X-LuckRead-Principal-Layer')).toBe('L2')
    expect(runtime.requests[0]?.headers.get('X-LuckRead-Principal-Verified')).toBe('true')
    expect(d1_02.prepare).not.toHaveBeenCalled()
    expect(d1_03.prepare).toHaveBeenCalledTimes(1)
    expect(d1_03.calls[0]?.sql).toContain('notification_push_endpoints')
    expect(d1_03.calls[0]?.values).toContain('user_test_01')
    expect(d1_03.calls[0]?.values).toContain(token)
  })

  it('propagates the W05 L2 guard before any D1-03 access', async () => {
    const { d1_03 } = connectW05()
    const response = await callW05Social({
      request: publicRequest('PUT'),
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'PUT',
      principal: { ...principal, layer: 'L1' },
      body: {
        platform: 'ios',
        permissionStatus: 'granted',
        expoPushToken: token,
      },
    })

    expect(response.status).toBe(403)
    expect(d1_03.prepare).not.toHaveBeenCalled()
  })

  it('forwards owner-scoped endpoint deletion and preserves the bodyless 204 response', async () => {
    const { service, d1_03 } = connectW05()
    const response = await callW05Social({
      request: publicRequest('DELETE'),
      pathname: '/internal/social/push-endpoints/' + installationId,
      method: 'DELETE',
      principal,
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(service.fetch).toHaveBeenCalledTimes(1)
    expect(d1_03.prepare).toHaveBeenCalledTimes(1)
    expect(d1_03.calls[0]?.sql).toBe(
      'DELETE FROM notification_push_endpoints WHERE owner_user_id = ? AND installation_id = ?',
    )
    expect(d1_03.calls[0]?.values).toEqual(['user_test_01', installationId])
  })
})
