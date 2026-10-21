/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createRepost, removeRepost } from './repost-runtime.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const db = (firstResults: unknown[] = [], changes = 1) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args, meta: { changes } })),
    })),
  }))
  return { prepare } as unknown as D1Database
}
const publishedBinding = (status = 200) => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json(status === 200 ? {
      data: { contentId, ownerUserId: 'owner-1', contentType: 'post', state: 'PUBLISHED' },
    } : { error: 'NOT_FOUND' }, { status })
  }),
}) as W03ContentBinding & { fetch: ReturnType<typeof vi.fn> }

const relation = {
  repost_id: 'repost-1', content_id: 'content-1', actor_user_id: 'viewer-1',
  created_at: '2026-10-15T00:00:00.000Z',
}

describe('repost runtime', () => {
  it('uses W03 for published content and writes only a W05 repost relation', async () => {
    const d = db([{ blocked: 0 }, null, relation])
    const binding = publishedBinding()
    await expect(createRepost(d, binding, 'viewer-1', 'content-1', 'corr-1')).resolves.toEqual({
      repostId: 'repost-1', contentId: 'content-1', actorUserId: 'viewer-1',
      createdAt: relation.created_at,
    })
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare.mock.calls.every(([sql]) => !/\b(?:FROM|JOIN|UPDATE|INSERT\s+INTO)\s+contents\b/i.test(String(sql)))).toBe(true)
    expect(String(prepare.mock.calls[0]?.[0])).toContain('social_user_interactions')
    expect(String(prepare.mock.calls[2]?.[0])).toContain('INSERT OR IGNORE INTO social_reposts')
    expect(String(prepare.mock.calls[2]?.[0])).not.toContain('SELECT')
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
  })

  it('fails closed before any W05 D1 access when W03 says content is not published', async () => {
    const d = db()
    await expect(createRepost(d, publishedBinding(404), 'viewer-1', 'content-1', 'corr-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('fails closed when W03 binding is unavailable', async () => {
    const d = db()
    await expect(createRepost(d, undefined, 'viewer-1', 'content-1', 'corr-1'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('returns the existing relation for a repeated repost', async () => {
    await expect(createRepost(db([{ blocked: 0 }, relation]), publishedBinding(), 'viewer-1', 'content-1', 'corr-1'))
      .resolves.toMatchObject({ repostId: 'repost-1', contentId: 'content-1' })
  })

  it('rejects blocked content owners', async () => {
    await expect(createRepost(db([{ blocked: 1 }]), publishedBinding(), 'viewer-1', 'content-1', 'corr-1'))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('validates actor identity and content identifiers', async () => {
    await expect(createRepost(db(), publishedBinding(), '', 'content-1', 'corr-1'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(createRepost(db(), publishedBinding(), 'viewer-1', 'content/1', 'corr-1'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('removes only the caller relation and tolerates a repeated remove', async () => {
    const d = db([], 0)
    await expect(removeRepost(d, 'viewer-1', 'content-1')).resolves.toBeUndefined()
    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(String(prepare.mock.calls[0]?.[0])).toContain('DELETE FROM social_reposts WHERE actor_user_id = ? AND content_id = ?')
  })
})
