import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class MockW06ModerationClientError extends Error {
    status = 503
    code = 'SERVICE_UNAVAILABLE'
  }
  return {
    MockW06ModerationClientError,
    resolvePrincipal: vi.fn(async (_request: Request) => ({ userId: 'reviewer_1', layer: 'L6', verified: true })),
    callW08Creator: vi.fn(async (_request: Request, _path: string, _method: 'GET' | 'POST') =>
      Response.json({ decision: 'ALLOW', policyVersion: 'casl-l0-l8-v1', layer: 'L6', action: 'moderation.queue.read', resourceType: 'ModerationQueue' })),
    creatorServiceUnavailable: vi.fn((_error: unknown) => Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Creator service unavailable', details: {} } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )),
    callW06Moderation: vi.fn(async (_input: unknown) => Response.json({ data: { ok: true } }, { status: 200 })),
  }
})

vi.mock('../../src/auth/w08-creator-client.js', () => ({
  callW08Creator: mocks.callW08Creator,
  creatorServiceUnavailable: mocks.creatorServiceUnavailable,
}))
vi.mock('../../src/moderation/w06-moderation-client.js', () => ({
  callW06Moderation: mocks.callW06Moderation,
  W06ModerationClientError: mocks.MockW06ModerationClientError,
}))
vi.mock('../../src/content/w03-content-client.js', () => ({
  resolveCookieContentPrincipal: mocks.resolvePrincipal,
}))

import { GET, POST } from '../../src/app/api/v1/admin/moderation/[[...path]]/route.js'

const headers = {
  Cookie: 'better-auth.session_token=test-session',
  'X-LuckRead-Correlation-Id': 'moderation-route-test',
  'X-LuckRead-Request-Id': 'req_moderation_route_test',
}
const decisionBody = {
  decision: 'APPROVED',
  expectedVersion: 1,
  policyVersion: 'moderation-v1.0',
  reasonCode: 'POLICY_MATCH',
  severity: 'medium',
  scope: 'content',
  effectiveAt: '2026-10-01T00:00:00.000Z',
  expiresAt: null as string | null,
}
const cases = [
  { name: 'queue', method: 'GET' as const, path: ['queue'], url: 'https://www.luckread.com/api/v1/admin/moderation/queue?limit=10', permission: 'moderation.queue.read', resourceType: 'ModerationQueue' },
  { name: 'case', method: 'GET' as const, path: ['cases', 'case_1'], url: 'https://www.luckread.com/api/v1/admin/moderation/cases/case_1', permission: 'moderation.case.read', resourceType: 'ModerationCase' },
  { name: 'decision', method: 'POST' as const, path: ['cases', 'case_1', 'decision'], url: 'https://www.luckread.com/api/v1/admin/moderation/cases/case_1/decision', permission: 'moderation.decide', resourceType: 'ModerationCase' },
] as const

beforeEach(() => {
  mocks.resolvePrincipal.mockReset()
  mocks.resolvePrincipal.mockResolvedValue({ userId: 'reviewer_1', layer: 'L6', verified: true })
  mocks.callW08Creator.mockReset()
  mocks.callW08Creator.mockImplementation(async (permissionRequest) => {
    const body = await permissionRequest.clone().json() as { action: string; resourceType: string }
    return Response.json({
      decision: 'ALLOW', policyVersion: 'casl-l0-l8-v1', layer: 'L6',
      action: body.action, resourceType: body.resourceType,
    })
  })
  mocks.creatorServiceUnavailable.mockClear()
  mocks.callW06Moderation.mockReset()
  mocks.callW06Moderation.mockResolvedValue(Response.json({ data: { ok: true } }, { status: 200 }))
})

describe('W01 moderation CASL admission boundary', () => {
  it('asks the existing W08 CASL service for each fixed permission before calling W06', async () => {
    for (const operation of cases) {
      const request = new Request(operation.url, {
        method: operation.method,
        headers: { ...headers, 'content-type': 'application/json' },
        ...(operation.method === 'POST' ? { body: JSON.stringify(decisionBody) } : {}),
      })
      const context = { params: Promise.resolve({ path: [...operation.path] }) }
      const response = operation.method === 'GET'
        ? await GET(request, context)
        : await POST(request, context)
      expect(response.status).toBe(200)
      const permissionRequest = mocks.callW08Creator.mock.calls.at(-1)?.[0] as unknown as Request
      expect(new URL(permissionRequest.url).pathname).toBe(new URL(operation.url).pathname)
      expect(mocks.callW08Creator.mock.calls.at(-1)?.[1]).toBe('/internal/authz/check-permission')
      expect(mocks.callW08Creator.mock.calls.at(-1)?.[2]).toBe('POST')
      await expect(permissionRequest.clone().json()).resolves.toEqual({
        action: operation.permission,
        resourceType: operation.resourceType,
      })
      const w06Input = mocks.callW06Moderation.mock.calls.at(-1)?.[0] as {
        permissionContext: {
          decision: string; permission: string; resourceType: string; policyVersion: string; subjectId: string; layer: string
        }
      }
      expect(w06Input.permissionContext).toEqual({
        decision: 'ALLOW',
        permission: operation.permission,
        resourceType: operation.resourceType,
        policyVersion: 'casl-l0-l8-v1',
        subjectId: 'reviewer_1',
        layer: 'L6',
      })
    }
    expect(mocks.callW08Creator).toHaveBeenCalledTimes(3)
    expect(mocks.callW06Moderation).toHaveBeenCalledTimes(3)
  })

  it('does not call W06 when W08 explicitly denies the permission', async () => {
    mocks.callW08Creator.mockResolvedValueOnce(Response.json({
      decision: 'DENY', reasonCode: 'ACTION_NOT_GRANTED', policyVersion: 'casl-l0-l8-v1',
      layer: 'L6', action: 'moderation.queue.read', resourceType: 'ModerationQueue',
    }))
    const response = await GET(
      new Request('https://www.luckread.com/api/v1/admin/moderation/queue', { headers }),
      { params: Promise.resolve({ path: ['queue'] }) },
    )
    expect(response.status).toBe(403)
    expect(mocks.callW06Moderation).not.toHaveBeenCalled()
  })

  it('fails closed when W08 returns mismatched authorization context', async () => {
    mocks.callW08Creator.mockResolvedValueOnce(Response.json({
      decision: 'ALLOW', policyVersion: 'casl-l0-l8-v1', layer: 'L6',
      action: 'moderation.queue.read', resourceType: 'ModerationCase',
    }))
    const response = await GET(
      new Request('https://www.luckread.com/api/v1/admin/moderation/queue', { headers }),
      { params: Promise.resolve({ path: ['queue'] }) },
    )
    expect(response.status).toBe(503)
    expect(mocks.callW06Moderation).not.toHaveBeenCalled()
  })

  it('fails closed when W08 CASL is unavailable', async () => {
    mocks.callW08Creator.mockRejectedValueOnce(new Error('W08 unavailable'))
    const response = await GET(
      new Request('https://www.luckread.com/api/v1/admin/moderation/queue', { headers }),
      { params: Promise.resolve({ path: ['queue'] }) },
    )
    expect(response.status).toBe(503)
    expect(mocks.creatorServiceUnavailable).toHaveBeenCalled()
    expect(mocks.callW06Moderation).not.toHaveBeenCalled()
  })
})
