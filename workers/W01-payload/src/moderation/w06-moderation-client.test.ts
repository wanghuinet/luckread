import { afterEach, describe, expect, it, vi } from 'vitest'

const cloudflareMocks = vi.hoisted(() => ({
  getCloudflareContext: vi.fn(),
}))
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: cloudflareMocks.getCloudflareContext,
}))

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { callW06Moderation, type W06ModerationPermissionContext } from './w06-moderation-client.js'

const contextMock = vi.mocked(getCloudflareContext)

afterEach(() => {
  vi.clearAllMocks()
})

describe('W01-to-W06 moderation authorization context', () => {
  it('forwards only the server-derived CASL proof and ignores caller-supplied authz headers', async () => {
    let forwarded: Request | null = null
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      forwarded = input instanceof Request ? input : new Request(input)
      return Response.json({ data: { ok: true } }, { status: 200 })
    })
    contextMock.mockResolvedValue({ env: { W06_MODERATION: { fetch } } } as never)

    const permissionContext: W06ModerationPermissionContext = {
      decision: 'ALLOW',
      permission: 'moderation.queue.read',
      resourceType: 'ModerationQueue',
      policyVersion: 'casl-l0-l8-v1',
      subjectId: 'reviewer_1',
      layer: 'L6',
    }
    const response = await callW06Moderation({
      request: new Request('https://www.luckread.com/api/v1/admin/moderation/queue', {
        headers: {
          Cookie: 'better-auth.session_token=browser',
          'X-LuckRead-Authz-Decision': 'ALLOW',
          'X-LuckRead-Authz-Permission': 'moderation.decide',
          'X-LuckRead-Authz-Resource-Type': 'ModerationCase',
        },
      }),
      pathname: '/admin/moderation/queue',
      method: 'GET',
      principal: { userId: 'reviewer_1', layer: 'L6' } as never,
      permissionContext,
    })
    expect(response.status).toBe(200)
    expect(forwarded).not.toBeNull()
    expect((forwarded as Request).headers.get('X-LuckRead-Authz-Decision')).toBe('ALLOW')
    expect((forwarded as Request).headers.get('X-LuckRead-Authz-Permission')).toBe('moderation.queue.read')
    expect((forwarded as Request).headers.get('X-LuckRead-Authz-Resource-Type')).toBe('ModerationQueue')
    expect((forwarded as Request).headers.get('X-LuckRead-Authz-Policy-Version')).toBe('casl-l0-l8-v1')
    expect((forwarded as Request).headers.get('X-LuckRead-Authz-Subject-Id')).toBe('reviewer_1')
    expect((forwarded as Request).headers.get('X-LuckRead-Authz-Layer')).toBe('L6')
  })
})
