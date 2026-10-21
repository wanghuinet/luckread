/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { createShare, resolveShare } from './share-runtime.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const db = (firstResults: unknown[] = []) => {
  let firstIndex = 0
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => firstResults[firstIndex++] ?? null),
      run: vi.fn(async () => ({ sql, args, success: true, meta: { changes: 1 } })),
    })),
  }))
  return { prepare } as unknown as D1Database
}

const publishedContextBinding = (status = 200): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const contentId = decodeURIComponent(parts.at(-2) ?? '')
    const body = {
      data: {
        contentId,
        ownerUserId: 'owner-1',
        contentType: 'post',
        state: 'PUBLISHED',
      },
    }
    return Response.json(status === 200 ? body : { error: 'NOT_FOUND' }, { status })
  }),
})

const shareRow = (contentId = 'content-1') => ({
  share_id: 'share-1',
  content_id: contentId,
  actor_user_id: 'user-1',
  created_at: '2026-10-02T00:00:00.000Z',
})

describe('share runtime', () => {
  it('creates a share token through W03 and only queries W05-owned share records', async () => {
    const d = db([null, shareRow()])
    const binding = publishedContextBinding()
    const result = await createShare(d, binding, 'user-1', 'content-1', 'share-request-1', 'correlation-1')

    expect(result).toMatchObject({ shareId: 'share-1', contentId: 'content-1', actorUserId: 'user-1' })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const sent = binding.fetch.mock.calls[0][0] as Request
    expect(sent.url).toContain('/internal/content/contents/content-1/published-social-context')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)

    const prepare = (d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare
    expect(prepare.mock.calls.some(([sql]) => /\b(?:FROM|JOIN)\s+contents\b/i.test(String(sql)))).toBe(false)
  })

  it('fails closed before reading or writing a share record when W03 says content is not published', async () => {
    const d = db()
    const binding = publishedContextBinding(404)
    await expect(createShare(d, binding, 'user-1', 'content-1', 'key-1', 'correlation-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    expect((d as unknown as { prepare: ReturnType<typeof vi.fn> }).prepare).not.toHaveBeenCalled()
  })

  it('is idempotent for the same actor and key', async () => {
    await expect(createShare(
      db([shareRow()]),
      publishedContextBinding(),
      'user-1',
      'content-1',
      'same-key',
      'correlation-1',
    )).resolves.toMatchObject({ shareId: 'share-1', contentId: 'content-1' })
  })

  it('rejects reuse of the same key for another content item', async () => {
    await expect(createShare(
      db([shareRow('content-1')]),
      publishedContextBinding(),
      'user-1',
      'content-2',
      'same-key',
      'correlation-1',
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
  })

  it('resolves a share only after W03 confirms the target is still published', async () => {
    const binding = publishedContextBinding()
    await expect(resolveShare(db([shareRow()]), binding, 'share-1', 'correlation-1')).resolves.toEqual({
      shareId: 'share-1',
      contentId: 'content-1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('returns not found for a missing share record', async () => {
    const binding = publishedContextBinding()
    await expect(resolveShare(db([null]), binding, 'share-1', 'correlation-1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    expect(binding.fetch).not.toHaveBeenCalled()
  })

  it('fails closed when W03 no longer exposes the content as published', async () => {
    await expect(resolveShare(
      db([shareRow()]),
      publishedContextBinding(404),
      'share-1',
      'correlation-1',
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('rejects invalid actor and idempotency inputs', async () => {
    await expect(createShare(db(), publishedContextBinding(), '', 'content-1', 'key', 'correlation-1'))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    await expect(createShare(db(), publishedContextBinding(), 'user-1', 'content-1', '', 'correlation-1'))
      .rejects.toMatchObject({ code: 'PRECONDITION_REQUIRED', status: 428 })
  })
})
