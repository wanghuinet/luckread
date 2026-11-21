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
    const lookup = clauses[1]?.or as Array<Record<string, any>> | undefined
    const filenames = lookup?.find((item) => item.filename)?.filename?.in as string[] | undefined
    const urls = lookup?.find((item) => item.url)?.url?.in as string[] | undefined
    return {
      docs: media.filter((item) => {
        const record = item as Record<string, unknown>
        const filenameMatch = typeof record.filename === 'string' && Boolean(filenames?.includes(record.filename))
        const urlMatch = typeof record.url === 'string' && Boolean(urls?.includes(record.url))
        return String(record.ownerUserId ?? '') === String(ownerId) && (filenameMatch || urlMatch)
      }),
    }
  }),
})

describe('W01/W03 social post media-reference authority boundary', () => {
  it('accepts body, attachments, and cover only when backed by current-owner Payload Media records', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'body-1', filename: 'body.txt', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'photo-1', filename: 'photo.png', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/photo.png' },
        { id: 'video-1', filename: 'clip.mp4', ownerUserId: 'payload-user-7', url: 'https://video.luckread.com/videos/clip.mp4' },
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
    const mediaQuery = payload.find.mock.calls[1]?.[0] as Record<string, any>
    expect(mediaQuery).toMatchObject({
      collection: 'media',
      where: {
        and: [
          { ownerUserId: { equals: 'payload-user-7' } },
          {
            or: [
              { filename: { in: expect.arrayContaining(['body.txt', 'photo.png', 'clip.mp4']) } },
              { url: { in: expect.arrayContaining([
                'https://img.luckread.com/media/body.txt',
                'https://img.luckread.com/media/photo.png',
                'https://video.luckread.com/videos/clip.mp4',
              ]) } },
            ],
          },
        ],
      },
      overrideAccess: true,
      select: { id: true, filename: true, url: true, ownerUserId: true },
    })
  })

  it('accepts an owned media record when its persisted filename differs from the URL filename', async () => {
    const actualUrl = 'https://img.luckread.com/media/generated-object-key.png'
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        {
          id: 'body-1',
          filename: 'post-body-generated-name.txt',
          ownerUserId: 'payload-user-7',
          url: 'https://img.luckread.com/media/body.txt',
        },
        {
          id: 'attachment-1',
          filename: 'payload-renamed-attachment.png',
          ownerUserId: 'payload-user-7',
          url: actualUrl,
        },
      ],
    )

    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post({
        bodyRef: 'https://img.luckread.com/media/body.txt',
        mediaRefs: [actualUrl],
        coverRef: null,
      }),
      origin,
    )).resolves.toEqual({ valid: true })

    const mediaQuery = payload.find.mock.calls[1]?.[0] as Record<string, any>
    const lookup = mediaQuery.where.and[1].or
    expect(lookup[0].filename.in).toEqual(['body.txt', 'generated-object-key.png'])
    expect(lookup[1].url.in).toContain(actualUrl)
  })

  it('rejects a valid LuckRead URL when the asset does not belong to this account', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'photo-from-other-user', filename: 'photo.png', ownerUserId: 'payload-user-8', url: 'https://img.luckread.com/media/photo.png' },
        { id: 'body-1', filename: 'body.txt', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'video-1', filename: 'clip.mp4', ownerUserId: 'payload-user-7', url: 'https://video.luckread.com/videos/clip.mp4' },
      ],
    )

    await expect(validateOwnedPostMediaReferencesWithPayload(
      payload,
      'better-auth-user-7',
      post(),
      origin,
    )).resolves.toMatchObject({ valid: false, status: 422, code: 'VALIDATION_FAILED' })
  })

  it('rejects an asset with the same filename but a different generated URL or host', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'body-1', filename: 'body.txt', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'photo-on-other-path', filename: 'photo.png', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/other/photo.png' },
        { id: 'video-1', filename: 'clip.mp4', ownerUserId: 'payload-user-7', url: 'https://video.luckread.com/videos/clip.mp4' },
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

  it('does not equate a relative same-path media record with an attachment on a different host', async () => {
    const payload = payloadFor(
      { id: 'payload-user-7' },
      [
        { id: 'body-1', filename: 'body.txt', ownerUserId: 'payload-user-7', url: 'https://img.luckread.com/media/body.txt' },
        { id: 'photo-relative', filename: 'photo.png', ownerUserId: 'payload-user-7', url: '/media/photo.png' },
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
})
