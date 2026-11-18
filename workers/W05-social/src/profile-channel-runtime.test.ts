import { describe, expect, it, vi } from 'vitest'
import { listProfileLikedContents, listProfileReplies } from './profile-channel-runtime.js'
import { ProfileChannelReadStoreError, type ProfileChannelReadStore, type ProfileReplyReadRow, type ProfileLikedContentReadRow, type ProfileBlockRelationRow } from './profile-channel-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const publishedContextsBinding = (
  ownerByContentId: Record<string, string | null> = {},
  unpublished: string[] = [],
): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.clone().json() as { contentIds: string[] }
    return Response.json({ data: { items: body.contentIds
      .filter(contentId => !unpublished.includes(contentId))
      .map(contentId => ({
        contentId, ownerUserId: ownerByContentId[contentId] ?? 'owner-2',
        contentType: 'post', state: 'PUBLISHED', updatedAt: '2026-10-17T04:00:00.000Z',
      })) } })
  }),
})

type StoreScenario = {
  replies?: readonly ProfileReplyReadRow[]
  liked?: readonly ProfileLikedContentReadRow[]
  visibility?: { blocked: boolean; muted: boolean }
  replyBlocks?: readonly ProfileBlockRelationRow[]
  likedBlocks?: readonly ProfileBlockRelationRow[]
  mutedOwners?: readonly { target_user_id: string }[]
}
const storeFor = (scenario: StoreScenario = {}): ProfileChannelReadStore => ({
  profileVisibility: vi.fn(async () => scenario.visibility ?? { blocked: false, muted: false }),
  listReplies: vi.fn(async () => scenario.replies ?? []),
  listReplyOwnerBlockRelations: vi.fn(async () => scenario.replyBlocks ?? []),
  listLikedContents: vi.fn(async () => scenario.liked ?? []),
  listLikedContentBlockRelations: vi.fn(async () => scenario.likedBlocks ?? []),
  listMutedOwners: vi.fn(async () => scenario.mutedOwners ?? []),
})
const reply = (id: string, contentId: string, createdAt: string): ProfileReplyReadRow => ({
  id, content_id: contentId, author_user_id: 'user-1', parent_id: null, body: 'Reply ' + id,
  state: 'PUBLISHED', depth: 0, created_at: createdAt, updated_at: createdAt,
})
const liked = (id: string, contentId: string, createdAt: string): ProfileLikedContentReadRow => ({
  relationship_id: id, target_id: contentId, created_at: createdAt,
})

describe('W05 Profile Channel runtime — Neon Store ports only', () => {
  it('lists published author replies after W03 validation and applies profile/owner Block-Mute visibility', async () => {
    const store = storeFor({ replies: [reply('comment-2', 'content-1', '2026-10-15T10:00:00.000Z')] })
    const binding = publishedContextsBinding({ 'content-1': 'owner-2' })
    const page = await listProfileReplies(store, binding, 'user-1', null, 10, 'viewer-1', 'profile-test')
    expect(page.items).toEqual([{
      id: 'comment-2', contentId: 'content-1', authorUserId: 'user-1', parentId: null,
      body: 'Reply comment-2', state: 'PUBLISHED', depth: 0,
      createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
    }])
    expect(store.profileVisibility).toHaveBeenCalledWith({ profileUserId: 'user-1', viewerUserId: 'viewer-1' })
    expect(store.listReplies).toHaveBeenCalledWith({ profileUserId: 'user-1', cursor: null, limit: 11 })
    expect(store.listReplyOwnerBlockRelations).toHaveBeenCalledWith({ profileUserId: 'user-1', ownerUserIds: ['owner-2'] })
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/published-social-context-batch')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
  })

  it('suppresses replies when profile-level Block or Mute visibility denies the viewer', async () => {
    const blocked = storeFor({ visibility: { blocked: true, muted: false }, replies: [reply('r1', 'content-1', '2026-10-15T10:00:00.000Z')] })
    await expect(listProfileReplies(blocked, publishedContextsBinding(), 'user-1', null, 10, 'viewer-1', 'profile-block'))
      .resolves.toEqual({ items: [], nextCursor: null, hasMore: false })
    expect(blocked.listReplies).not.toHaveBeenCalled()
    const muted = storeFor({ visibility: { blocked: false, muted: true } })
    await expect(listProfileReplies(muted, publishedContextsBinding(), 'user-1', null, 10, 'viewer-1', 'profile-mute'))
      .resolves.toEqual({ items: [], nextCursor: null, hasMore: false })
    expect(muted.listReplies).not.toHaveBeenCalled()
  })

  it('scopes reply cursors to profile and viewer and preserves bounded pagination', async () => {
    const store = storeFor({ replies: [
      reply('c2', 'content-1', '2026-10-15T10:00:00.000Z'),
      reply('c1', 'content-1', '2026-10-14T10:00:00.000Z'),
    ] })
    const page = await listProfileReplies(store, publishedContextsBinding(), 'user-1', null, 1, 'viewer-1', 'profile-cursor')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listProfileReplies(store, undefined, 'user-2', page.nextCursor, 1, 'viewer-1', 'profile-cursor'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileReplies(store, undefined, 'user-1', page.nextCursor, 1, 'viewer-2', 'profile-cursor'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileReplies(store, undefined, 'user-1', null, 51, null, 'profile-cursor'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('fails closed when parent content context or the Store is unavailable', async () => {
    const store = storeFor({ replies: [reply('r1', 'content-1', '2026-10-15T10:00:00.000Z')] })
    const unavailable = { fetch: vi.fn(async () => Response.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 })) }
    await expect(listProfileReplies(store, unavailable, 'user-1', null, 10, null, 'profile-w03-unavailable'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    const brokenStore = storeFor()
    vi.mocked(brokenStore.listReplies).mockRejectedValue(new ProfileChannelReadStoreError())
    await expect(listProfileReplies(brokenStore, publishedContextsBinding(), 'user-1', null, 10, null, 'profile-store-unavailable'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('validates liked-content visibility through one W03 batch and applies bidirectional Block plus viewer Mute filtering', async () => {
    const store = storeFor({
      liked: [liked('like-1', 'content-1', '2026-10-15T10:00:00.000Z')],
    })
    const binding = publishedContextsBinding()
    await expect(listProfileLikedContents(store, binding, 'user-1', null, 10, 'viewer-2', 'profile-likes-test'))
      .resolves.toEqual({ items: [{ contentId: 'content-1', likedAt: '2026-10-15T10:00:00.000Z' }], nextCursor: null, hasMore: false })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    expect(store.listLikedContentBlockRelations).toHaveBeenCalledWith({
      principalUserIds: ['user-1', 'viewer-2'], ownerUserIds: ['owner-2'],
    })
    expect(store.listMutedOwners).toHaveBeenCalledWith({ viewerUserId: 'viewer-2', ownerUserIds: ['owner-2'] })
  })

  it('filters unpublished, blocked-owner and muted-owner liked content after W03 validation', async () => {
    const store = storeFor({
      liked: [
        liked('like-1', 'content-blocked', '2026-10-15T12:00:00.000Z'),
        liked('like-2', 'content-muted', '2026-10-15T11:00:00.000Z'),
        liked('like-3', 'content-unpublished', '2026-10-15T10:00:00.000Z'),
        liked('like-4', 'content-visible', '2026-10-15T09:00:00.000Z'),
      ],
      likedBlocks: [{ actor_user_id: 'user-1', target_user_id: 'owner-blocked' }],
      mutedOwners: [{ target_user_id: 'owner-muted' }],
    })
    const binding = publishedContextsBinding({
      'content-blocked': 'owner-blocked', 'content-muted': 'owner-muted', 'content-visible': 'owner-visible',
    }, ['content-unpublished'])
    const page = await listProfileLikedContents(store, binding, 'user-1', null, 10, 'viewer-2', 'profile-likes-visibility')
    expect(page.items).toEqual([{ contentId: 'content-visible', likedAt: '2026-10-15T09:00:00.000Z' }])
    expect(page.hasMore).toBe(false)
  })

  it('fails closed when W03 cannot validate a liked-content target', async () => {
    const store = storeFor({ liked: [liked('like-1', 'content-1', '2026-10-15T10:00:00.000Z')] })
    const binding = { fetch: vi.fn(async () => Response.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 })) }
    await expect(listProfileLikedContents(store, binding, 'user-1', null, 10, null, 'profile-likes-unavailable'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('uses profile- and viewer-scoped opaque likes cursors and validates page limits', async () => {
    const store = storeFor({ liked: [
      liked('like-2', 'content-2', '2026-10-15T10:00:00.000Z'),
      liked('like-1', 'content-1', '2026-10-14T10:00:00.000Z'),
    ] })
    const page = await listProfileLikedContents(store, publishedContextsBinding(), 'user-1', null, 1, 'viewer-1', 'profile-likes-cursor')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))
    await expect(listProfileLikedContents(store, undefined, 'user-2', page.nextCursor, 1, 'viewer-1', 'profile-likes-cursor'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileLikedContents(store, undefined, 'user-1', null, 51, null, 'profile-likes-cursor'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('accepts the PostgreSQL Store contract and preserves microsecond timestamp precision', async () => {
    const store = storeFor({
      replies: [{
        ...reply('reply-pg-1', 'content-1', '2026-11-10T04:00:00.123456Z'),
        updated_at: '2026-11-10T04:00:00.123789Z',
      }],
      liked: [liked('like-pg-1', 'content-2', '2026-11-10T05:00:00.456789Z')],
    })
    const binding = publishedContextsBinding()
    await expect(listProfileReplies(store, binding, 'user-1', null, 10, 'viewer-1', 'profile-pg-test'))
      .resolves.toMatchObject({ items: [{ id: 'reply-pg-1', createdAt: '2026-11-10T04:00:00.123456Z' }] })
    await expect(listProfileLikedContents(store, binding, 'user-1', null, 10, 'viewer-1', 'profile-pg-test'))
      .resolves.toMatchObject({ items: [{ contentId: 'content-2', likedAt: '2026-11-10T05:00:00.456789Z' }] })
  })
})
