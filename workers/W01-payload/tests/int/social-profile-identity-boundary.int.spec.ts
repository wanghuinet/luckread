import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPayload } = vi.hoisted(() => ({ mockGetPayload: vi.fn() }))

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }))
vi.mock('payload', () => ({ getPayload: mockGetPayload }))
vi.mock('@payload-config', () => ({ default: {} }))

import { resolveSocialProfileIdentityId } from '../../src/social/w05-social-client.js'

describe('W01 social profile identity boundary', () => {
  beforeEach(() => mockGetPayload.mockReset())

  it('maps a legacy Payload row ID to the canonical W02 identity ID', async () => {
    const findByID = vi.fn().mockResolvedValue({ id: 27, identityId: 'w02-user-27' })
    const find = vi.fn()
    mockGetPayload.mockResolvedValue({ findByID, find })

    await expect(resolveSocialProfileIdentityId('27')).resolves.toBe('w02-user-27')
    expect(findByID).toHaveBeenCalledWith({
      collection: 'users',
      id: '27',
      depth: 0,
      overrideAccess: true,
    })
    expect(find).not.toHaveBeenCalled()
  })

  it('accepts a canonical identity ID without treating it as a Payload row ID', async () => {
    const findByID = vi.fn()
    const find = vi.fn().mockResolvedValue({ docs: [{ id: 27, identityId: 'w02-user-27' }] })
    mockGetPayload.mockResolvedValue({ findByID, find })

    await expect(resolveSocialProfileIdentityId('w02-user-27')).resolves.toBe('w02-user-27')
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'users',
      where: { identityId: { equals: 'w02-user-27' } },
      depth: 0,
      limit: 1,
      overrideAccess: true,
    }))
    expect(findByID).not.toHaveBeenCalled()
  })

  it('fails closed when a Payload row has no canonical identity mapping', async () => {
    mockGetPayload.mockResolvedValue({
      findByID: vi.fn().mockResolvedValue({ id: 27 }),
      find: vi.fn(),
    })

    await expect(resolveSocialProfileIdentityId('27')).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    })
  })

  it('returns not found when neither the Payload ID nor identity ID resolves', async () => {
    const notFound = Object.assign(new Error('User not found'), { status: 404 })
    mockGetPayload.mockResolvedValue({
      findByID: vi.fn().mockRejectedValue(notFound),
      find: vi.fn().mockResolvedValue({ docs: [] }),
    })

    await expect(resolveSocialProfileIdentityId('27')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    })
  })

  it('does not hide database failures behind a not-found response', async () => {
    mockGetPayload.mockResolvedValue({
      findByID: vi.fn().mockRejectedValue(new Error('database unavailable')),
      find: vi.fn(),
    })

    await expect(resolveSocialProfileIdentityId('27')).rejects.toThrow('database unavailable')
  })
})
