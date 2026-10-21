/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { fetchReplyAudienceContentContext } from './w03-content-context-client.js'

describe('W05 to W03 reply-audience context binding', () => {
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
    await expect(fetchReplyAudienceContentContext(binding, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-1',
    })).resolves.toMatchObject({ ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED' })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const request = forwarded as unknown as Request
    expect(request.url).toContain('/internal/content/contents/content-1/reply-audience-context')
    expect(request.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(request.headers.get('X-LuckRead-Principal-User-Id')).toBe('owner-1')
    expect(request.headers.get('X-LuckRead-Principal-Layer')).toBe('L2')
    expect(request.headers.get('X-LuckRead-Correlation-Id')).toBe('correlation-1')
    expect(request.headers.has('Authorization')).toBe(false)
    expect(request.headers.has('Cookie')).toBe(false)
  })

  it('fails closed when the binding is missing or returns invalid ownership context', async () => {
    await expect(fetchReplyAudienceContentContext(undefined, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-1',
    })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })

    await expect(fetchReplyAudienceContentContext({
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
    await expect(fetchReplyAudienceContentContext(binding, {
      principalUserId: 'owner-1',
      principalLayer: 'L2',
      contentId: 'content-1',
      correlationId: 'correlation-2',
    })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })
})
