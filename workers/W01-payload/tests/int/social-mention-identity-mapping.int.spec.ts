import { beforeEach, describe, expect, it, vi } from 'vitest'

const { find } = vi.hoisted(() => ({ find: vi.fn() }))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ find })),
}))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }))

import { resolveSocialMentionTargets } from '../../src/social/w05-social-client.js'

describe('social mention identity mapping', () => {
  beforeEach(() => {
    find.mockReset()
    find.mockResolvedValue({
      docs: [
        { id: 17, identityId: 'w02-identity-alice', username: 'alice' },
        { id: 18, identityId: null, username: 'legacyprofile' },
      ],
    })
  })

  it('sends canonical W02 identity IDs to W05, not numeric Payload profile IDs', async () => {
    await expect(resolveSocialMentionTargets('Hello @alice and @legacyprofile'))
      .resolves.toEqual([
        { userId: 'w02-identity-alice', handle: 'alice' },
      ])

    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'users',
      where: { username: { in: ['alice', 'legacyprofile'] } },
      depth: 0,
      limit: 2,
      overrideAccess: true,
      select: { identityId: true, username: true },
    }))
  })

  it('does not emit a social target for a profile without a W02 identity mapping', async () => {
    find.mockResolvedValueOnce({
      docs: [{ id: 18, identityId: null, username: 'legacyprofile' }],
    })

    await expect(resolveSocialMentionTargets('@legacyprofile')).resolves.toEqual([])
  })
})
