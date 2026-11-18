/// <reference types="@cloudflare/workers-types" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLikeStatus, like, unlike } from './like-runtime.js'
import { LikeMutationStoreError, type LikeMutationStore } from './like-mutation-store.js'
import { LikeTargetContextReadStoreError, type LikeTargetContextReadStore } from './like-target-context-read-store.js'
import type { LikeStatusReadStore } from './like-status-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const correlationId = 'like-runtime-test'
const publishedContextBinding = (ownerUserId = 'user-2', status = 200): W03ContentBinding => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = decodeURIComponent(new URL(request.url).pathname.split('/').at(-2) ?? '')
    if (status !== 200) return Response.json({ error: { code: 'NOT_FOUND' } }, { status })
    return Response.json({ data: { contentId, ownerUserId, contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z' } })
  }),
})
const targetStore = (overrides: Partial<LikeTargetContextReadStore> = {}): LikeTargetContextReadStore => ({
  readCommentTarget: vi.fn(async () => ({ id: 'comment-1', state: 'PUBLISHED', author_user_id: 'comment-author', content_id: 'content-1' })),
  hasBidirectionalBlock: vi.fn(async () => false), ...overrides,
})
const mutationStore = (overrides: Partial<LikeMutationStore> = {}): LikeMutationStore => ({
  create: vi.fn(async () => ({ relationship_id: 'like-1', actor_user_id: 'user-1', target_type: 'content' as const, target_id: 'content-1', created_at: '2026-11-10T00:00:00.000Z' })),
  remove: vi.fn(async () => undefined), ...overrides,
})
afterEach(() => { delete (globalThis as Record<string, unknown>).caches })

describe('like runtime — Neon Store ports only', () => {
  it('validates W03 visibility and Block policy before serving cached state', async () => {
    const cache = { match: vi.fn(async (r: Request) => r.url.includes('__social-like-viewer-state') ? Response.json({ liked: true }) : Response.json({ likeCount: 9 })), put: vi.fn(async () => undefined), delete: vi.fn(async () => true) }
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })
    const context = targetStore()
    await expect(getLikeStatus(publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, { read: vi.fn() }, context)).resolves.toEqual({ liked: true, likeCount: 9 })
    expect(context.hasBidirectionalBlock).toHaveBeenCalledWith('user-1', ['user-2'])
  })
  it('uses the injected status Store on cache miss', async () => {
    const status = { read: vi.fn(async () => ({ liked: true, likeCount: 4 })) }
    await expect(getLikeStatus(publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, status, targetStore())).resolves.toEqual({ liked: true, likeCount: 4 })
    expect(status.read).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'user-1', includeCount: true }))
  })
  it('rejects either-direction Block before status storage', async () => {
    const status = { read: vi.fn() }
    await expect(getLikeStatus(publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, status, targetStore({ hasBidirectionalBlock: vi.fn(async () => true) }))).rejects.toMatchObject({ code: 'CONFLICT', status: 409 })
    expect(status.read).not.toHaveBeenCalled()
  })
  it('checks comment author and W03 parent owner before comment-like write', async () => {
    const context = targetStore(), writer = mutationStore()
    await expect(like(publishedContextBinding('content-owner'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId, undefined, writer, context)).resolves.toMatchObject({ relationshipId: 'like-1' })
    expect(context.readCommentTarget).toHaveBeenCalledWith('comment-1')
    expect(context.hasBidirectionalBlock).toHaveBeenCalledWith('user-1', ['comment-author', 'content-owner'])
    expect(writer.create).toHaveBeenCalledWith(expect.objectContaining({ parentOwnerUserId: 'content-owner' }))
  })
  it('does not mutate when W03 rejects content visibility', async () => {
    const writer = mutationStore()
    await expect(like(publishedContextBinding('user-2', 404), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, writer, targetStore())).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(writer.create).not.toHaveBeenCalled()
  })
  it('maps target context storage failures to sanitized 503', async () => {
    await expect(like(publishedContextBinding(), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId, undefined, mutationStore(), targetStore({ readCommentTarget: vi.fn(async () => { throw new LikeTargetContextReadStoreError() }) }))).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
  it('maps a rejected final guarded insert to 404 and mutation failures to 503', async () => {
    await expect(like(publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, mutationStore({ create: vi.fn(async () => null) }), targetStore())).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    await expect(like(publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, mutationStore({ create: vi.fn(async () => { throw new LikeMutationStoreError() }) }), targetStore())).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
  it('invalidates viewer and aggregate caches after Like and Unlike', async () => {
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined), delete: vi.fn(async () => true) }
    Object.defineProperty(globalThis, 'caches', { value: { default: cache }, configurable: true })
    const writer = mutationStore()
    await like(publishedContextBinding(), 'user-1', { targetType: 'content', targetId: 'content-1' }, correlationId, undefined, writer, targetStore())
    await unlike('user-1', { targetType: 'content', targetId: 'content-1' }, writer)
    expect(writer.remove).toHaveBeenCalledWith({ actorUserId: 'user-1', targetType: 'content', targetId: 'content-1' })
    expect(cache.delete).toHaveBeenCalledTimes(4)
  })
  it('uses injected Store for comment status and rejects invalid target types', async () => {
    const status: LikeStatusReadStore = { read: vi.fn(async () => ({ liked: false, likeCount: 2 })) }
    await expect(getLikeStatus(publishedContextBinding('content-owner'), 'user-1', { targetType: 'comment', targetId: 'comment-1' }, correlationId, undefined, status, targetStore())).resolves.toEqual({ liked: false, likeCount: 2 })
    await expect(like(publishedContextBinding(), 'user-1', { targetType: 'media', targetId: 'media-1' }, correlationId, undefined, mutationStore(), targetStore())).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })
})
