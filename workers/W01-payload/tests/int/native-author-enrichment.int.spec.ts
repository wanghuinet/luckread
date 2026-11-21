import { beforeEach, describe, expect, it, vi } from 'vitest'

const { find } = vi.hoisted(() => ({ find: vi.fn() }))

vi.mock('payload', () => ({
  getPayload: vi.fn(async () => ({ find })),
}))
vi.mock('@payload-config', () => ({ default: {} }))

import {
  enrichCommentListAuthors,
  enrichContentListAuthors,
} from '../../src/lib/enrich-public-authors.js'

describe('batched public author enrichment', () => {
  beforeEach(() => {
    find.mockReset()
    find.mockResolvedValue({
      docs: [{
        id: 'profile-1',
        identityId: 'identity-1',
        username: 'reader1',
        displayName: 'Reader One',
        avatar: '/media/avatar-1',
        email: 'must-not-be-public@example.com',
      }],
    })
  })

  it('hydrates a content page with one profile query for multiple items', async () => {
    const response = Response.json({
      data: {
        items: [
          { id: 'content-1', creatorId: 'identity-1', title: 'One' },
          { id: 'content-2', ownerUserId: 'identity-1', title: 'Two' },
        ],
        nextCursor: null,
        hasMore: false,
      },
      requestId: 'req-content-list',
    })

    const enriched = await enrichContentListAuthors(response)
    const body = await enriched.json() as {
      data: { items: Array<{ creator?: Record<string, unknown> }> }
      requestId: string
    }

    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      collection: 'users',
      overrideAccess: true,
      depth: 0,
      where: {
        or: [
          { id: { in: ['identity-1'] } },
          { identityId: { in: ['identity-1'] } },
        ],
      },
    }))
    expect(body.data.items[0].creator).toMatchObject({
      id: 'profile-1',
      username: 'reader1',
      displayName: 'Reader One',
      avatar: '/media/avatar-1',
    })
    expect(body.data.items[1].creator?.username).toBe('reader1')
    expect(JSON.stringify(body)).not.toContain('must-not-be-public@example.com')
    expect(body.requestId).toBe('req-content-list')
  })

  it('hydrates comment authors in the existing comment list response', async () => {
    const response = Response.json({
      data: {
        items: [{ id: 'comment-1', authorUserId: 'identity-1', body: 'Hello' }],
        nextCursor: null,
        hasMore: false,
      },
      requestId: 'req-comments',
    })

    const enriched = await enrichCommentListAuthors(response)
    const body = await enriched.json() as {
      data: { items: Array<{ author?: Record<string, unknown> }> }
    }

    expect(find).toHaveBeenCalledTimes(1)
    expect(body.data.items[0].author).toMatchObject({
      id: 'profile-1',
      username: 'reader1',
      displayName: 'Reader One',
      avatar: '/media/avatar-1',
    })
  })

  it('keeps the original successful response when profile projection lookup fails', async () => {
    find.mockRejectedValue(new Error('profile projection unavailable'))
    const response = Response.json({
      data: { items: [{ id: 'content-1', creatorId: 'identity-1' }] },
      requestId: 'req-fallback',
    })

    const enriched = await enrichContentListAuthors(response)

    expect(enriched.status).toBe(200)
    expect(await enriched.json()).toEqual({
      data: { items: [{ id: 'content-1', creatorId: 'identity-1' }] },
      requestId: 'req-fallback',
    })
  })
})
