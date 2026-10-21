/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { fetchOwnedPostContext, fetchPublishedContentSocialContext, fetchPublishedOwnerPostContext } from './w03-content-context-client.js'

describe('W05 to W03 owned-post context binding', () => {
  it('forwards only the trusted principal and correlation metadata', async () => {
    let forwarded: Request | null = null
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        forwarded = input as Request
        return Response.json({
          data: {
            contentId: 'content-1',
            ownerUserId: 'owner-1',
            contentType: 'post',
            state: 'PUBLISHED',
            updatedAt: '2026-10-20T00:00:00.000Z',
          },
          requestId: 'req_1',
        })
      }),
    }
    await expect(fetchOwnedPostContext(binding, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-1',
    })).resolves.toMatchObject({ ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED' })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const request = forwarded as unknown as Request
    expect(request.url).toContain('/internal/content/contents/content-1/owned-post-context')
    expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(request.headers.get('X-LuckRead-Principal-User-Id')).toBe('owner-1')
    expect(request.headers.get('X-LuckRead-Principal-Layer')).toBe('L2')
    expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe('correlation-1')
    expect(request.headers.has('Authorization')).toBe(false)
    expect(request.headers.has('Cookie')).toBe(false)
  })

  it('fails closed when the binding is missing or returns invalid ownership context', async () => {
    await expect(fetchOwnedPostContext(undefined, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-1',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    await expect(fetchOwnedPostContext({
      fetch: async () => Response.json({ data: {
        contentId: 'content-1',
        ownerUserId: 'other-user',
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-10-20T00:00:00.000Z',
      } }),
    }, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-1',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('maps W03 owner-scoped not-found responses without returning private details', async () => {
    const binding = {
      fetch: async () => Response.json({
        error: { code: 'NOT_FOUND', message: 'Content not found', details: {} },
        requestId: 'req_2',
      }, { status: 404 }),
    }
    await expect(fetchOwnedPostContext(binding, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-2',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
  it('resolves only a published post matching the public profile owner', async () => {
    let forwarded: Request | null = null
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        forwarded = input as Request
        return Response.json({
          data: {
            contentId: 'content-1',
            ownerUserId: 'owner-1',
            contentType: 'post',
            state: 'PUBLISHED',
            updatedAt: '2026-10-20T00:00:00.000Z',
          },
          requestId: 'req_public_context',
        })
      }),
    }
    await expect(fetchPublishedOwnerPostContext(binding, {
      ownerUserId: 'owner-1',
      contentId: 'content-1',
      correlationId: 'public-pin-1',
    })).resolves.toMatchObject({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })
    const request = forwarded as unknown as Request
    expect(request.url).toContain('/internal/content/contents/content-1/public-post-context/owner-1')
    expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe('public-pin-1')
    expect(request.headers.has('X-LuckRead-Principal-User-Id')).toBe(false)
    expect(request.headers.has('Authorization')).toBe(false)
    expect(request.headers.has('Cookie')).toBe(false)
  })

  it('fails closed for missing, mismatched, or non-published public post context', async () => {
    await expect(fetchPublishedOwnerPostContext(undefined, {
      ownerUserId: 'owner-1',
      contentId: 'content-1',
      correlationId: 'public-pin-missing',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    const input = { ownerUserId: 'owner-1', contentId: 'content-1', correlationId: 'public-pin-invalid' }
    for (const data of [
      { contentId: 'content-1', ownerUserId: 'other-owner', contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-20T00:00:00.000Z' },
      { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'article', state: 'PUBLISHED', updatedAt: '2026-10-20T00:00:00.000Z' },
      { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'UNPUBLISHED', updatedAt: '2026-10-20T00:00:00.000Z' },
    ]) {
      await expect(fetchPublishedOwnerPostContext({
        fetch: async () => Response.json({ data }),
      }, input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    }
    await expect(fetchPublishedOwnerPostContext({
      fetch: async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
    }, input)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('resolves published content owner for notification routing without forwarding caller credentials', async () => {
    let forwarded: Request | null = null
    const binding = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        forwarded = input as Request
        return Response.json({
          data: {
            contentId: 'content-1',
            ownerUserId: 'owner-1',
            contentType: 'article',
            state: 'PUBLISHED',
            updatedAt: '2026-10-17T04:00:00.000Z',
          },
          requestId: 'req_social_context',
        })
      }),
    }
    await expect(fetchPublishedContentSocialContext(binding, {
      contentId: 'content-1',
      correlationId: 'like-notification-1',
    })).resolves.toEqual({
      contentId: 'content-1',
      ownerUserId: 'owner-1',
      contentType: 'article',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })
    const request = forwarded as unknown as Request
    expect(request.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe('like-notification-1')
    expect(request.headers.has('X-LuckRead-Principal-User-Id')).toBe(false)
    expect(request.headers.has('Authorization')).toBe(false)
    expect(request.headers.has('Cookie')).toBe(false)
  })

  it('fails closed for missing, non-published, or malformed social context', async () => {
    const input = { contentId: 'content-1', correlationId: 'social-context-fail-closed' }
    await expect(fetchPublishedContentSocialContext(undefined, input))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    await expect(fetchPublishedContentSocialContext({
      fetch: async () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
    }, input)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    for (const data of [
      { contentId: 'other-content', ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED' },
      { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'comment', state: 'PUBLISHED' },
      { contentId: 'content-1', ownerUserId: 'owner-1', contentType: 'post', state: 'DRAFT' },
      { contentId: 'content-1', ownerUserId: 'bad/id', contentType: 'post', state: 'PUBLISHED' },
    ]) {
      await expect(fetchPublishedContentSocialContext({
        fetch: async () => Response.json({ data }),
      }, input)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    }
  })

})
