import { describe, expect, it, vi } from 'vitest'

import { validateOwnedPostMediaReferencesWithPayload } from '../../src/content/validate-owned-post-media-references.js'

const origin = 'https://api.luckread.com'

const post = (overrides: Record<string, unknown> = {}) => ({
  contentType: 'post',
  title: 'My post',
  bodyRef: 'https://img.luckread.com/media/body.txt',
  mediaRefs: [
    'https://img.luckread.com/media/photo.png',
    'https://video.luckread.com/videos/clip.mp4',
  ],
  coverRef: 'https://img.luckread.com/media/photo.png',
  ...overrides,
})

const payloadFor = (
  profile: unknown,
  media: unknown[],
) => ({
  find: vi.fn(async (query: Record<string, unknown>) => {
    if (query.collection === 'users') return { docs: profile ? [profile] : [] }
    const clauses = (query.where as { and?: Array<Record<string, any>> }).and ?? []
    const ownerId = clauses[0]?.ownerUserId?.equals
    const urls = clauses[1]?.url?.in as string[] | undefined
    return {
      docs: media.filter((item) => {
        const record = item as Record<string, unknown>
        return String(record.ownerUserId ?? '') === String(ownerId) &&
          typeof record.url === 'string' && Boolean(urls?.includes(record.url))
      }),
    }
  }),
})

describe('W01/W03 social post media-reference authority boundary', () => {
  it('accepts body, attachments, and cover only when backed by current-owner Payload Media records', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'body-1', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'photo-1', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/photo.png' },
        { id: 'video-1', ownerUserId: 'payload-user-7', url: 'https://video.luckread.com/videos/clip.mp4' },
      ],
    )

    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post(),
      origin,
    )).resolves.toEqual({ valid: true })

    expect(payload.find).toHaveBeenCalledTimes(2)
    expect(payload.find.mock.calls[0]?.[0]).toMatchObject({
      collection: 'users',
      where: { identityId: { equals: 'better-auth-user-7' } },
      overrideAccess: true,
    })
    expect(payload.find.mock.calls[1]?.[0]).toMatchObject({
      collection: 'media',
      where: {
        and: [
          { ownerUserId: { equals: 'payload-user-7' } },
          { url: { in: expect.arrayContaining([
            'https://img.luckread.com/media/body.txt',
            'https://img.luckread.com/media/photo.png',
            'https://video.luckread.com/videos/clip.mp4',
          ]) } },
        ],
      },
      overrideAccess: true,
    })
  })

  it('rejects a valid LuckRead URL when the asset does not belong to this account', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'photo-from-other-user', ownerUserId: 'payload-user-8', url: 'https://img.luckread.com/media/photo.png' },
        { id: 'body-1', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'video-1', ownerUserId: 'payload-user-7', url: 'https://video.luckread.com/videos/clip.mp4' },
      ],
    )

    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post(),
      origin,
    )).resolves.toMatchObject({ valid: false, status: 422, code: 'VALIDATION_FAILED' })
  })

  it('rejects untrusted or missing object URLs before looking up a media record', async () => {
    const payload = payloadFor({ id: 'payload-user-7' }, [])
    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post({ mediaRefs: ['https://attacker.example/forged.png'] }),
      origin,
    )).resolves.toMatchObject({ valid: false, status: 422, code: 'VALIDATION_FAILED' })
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('rejects a missing Payload profile rather than treating the media as authorized', async () => {
    const payload = payloadFor(null, [])
    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post(),
      origin,
    )).resolves.toMatchObject({ valid: false, status: 401, code: 'UNAUTHENTICATED' })
    expect(payload.find).toHaveBeenCalledTimes(1)
  })

  it('does not add media-table reads to article mutations', async () => {
    const payload = payloadFor(null, [])
    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      { contentType: 'article', bodyRef: 'legacy article body' },
      origin,
    )).resolves.toEqual({ valid: true })
    expect(payload.find).not.toHaveBeenCalled()
  })
})

  it('does not equate a relative same-path media record with an attachment on a different host', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'body-1', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'photo-relative', ownerUserId: 'payload-user-7', url: '/media/photo.png' },
      ],
    )

    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post({
        mediaRefs: ['https://img.luckread.com/media/photo.png'],
        coverRef: 'https://img.luckread.com/media/photo.png',
      }),
      origin,
    )).resolves.toMatchObject({ valid: false, status: 422, code: 'VALIDATION_FAILED' })
  })
