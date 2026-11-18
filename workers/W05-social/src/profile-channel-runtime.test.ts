import { describe, expect, it, vi } from 'vitest'
import { listProfileLikedContents, listProfileReplies } from './profile-channel-runtime.js'
import {
  ProfileChannelReadStoreError,
  type ProfileBlockRelationRow,
  type ProfileChannelReadStore,
  type ProfileLikedContentReadRow,
  type ProfileReplyReadRow,
} from './profile-channel-read-store.js'
import type { W03ContentBinding } from './w03-content-context-client.js'

const publishedContextsBinding = (): W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } => ({
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.clone().json() as { contentIds: string[] }
    return Response.json({ data: { items: body.contentIds.map(contentId => ({
      contentId,
      ownerUserId: 'owner-2',
      contentType: 'post',
      state: 'PUBLISHED',
      updatedAt: '2026-10-17T04:00:00.000Z',
    })) } })
  }),
})

const makeStore = (overrides: Partial<ProfileChannelReadStore> = {}): ProfileChannelReadStore => ({
  profileVisibility: vi.fn(async () => ({ blocked: false, muted: false })),
  listReplies: vi.fn(async () => []),
  listReplyOwnerBlockRelations: vi.fn(async () => []),
  listLikedContents: vi.fn(async () => []),
  listLikedContentBlockRelations: vi.fn(async () => []),
  listMutedOwners: vi.fn(async () => []),
  ...overrides,
})

const reply = (overrides: Partial<ProfileReplyReadRow> = {}): ProfileReplyReadRow => ({
  id: 'comment-2',
  content_id: 'content-1',
  author_user_id: 'user-1',
  parent_id: 'comment-1',
  body: 'A reply',
  state: 'PUBLISHED',
  depth: 1,
  created_at: '2026-10-15T10:00:00.000Z',
  updated_at: '2026-10-15T10:00:00.000Z',
  ...overrides,
})

const liked = (relationshipId: string, contentId: string, createdAt: string): ProfileLikedContentReadRow => ({
  relationship_id: relationshipId,
  target_id: contentId,
  created_at: createdAt,
})

describe('W05 profile channel runtime', () => {
  it('lists published replies after profile visibility, W03 context and owner Block filtering', async () => {
    const store = makeStore({
      listReplies: vi.fn(async () => [reply()]),
    })
    const binding = publishedContextsBinding()
    const page = await listProfileReplies(store, binding, 'user-1', null, 10, 'viewer-1', 'profile-test')
    expect(page.items).toEqual([{
      id: 'comment-2',
      contentId: 'content-1',
      authorUserId: 'user-1',
      parentId: 'comment-1',
      body: 'A reply',
      state: 'PUBLISHED',
      depth: 1,
      createdAt: '2026-10-15T10:00:00.000Z',
      updatedAt: '2026-10-15T10:00:00.000Z',
    }])
    expect(store.profileVisibility).toHaveBeenCalledWith({ profileUserId: 'user-1', viewerUserId: 'viewer-1' })
    expect(store.listReplies).toHaveBeenCalledWith({ profileUserId: 'user-1', cursor: null, limit: 11 })
    expect(store.listReplyOwnerBlockRelations).toHaveBeenCalledWith({ profileUserId: 'user-1', ownerUserIds: ['owner-2'] })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not expose replies when the viewer is blocked or muted by the profile', async () => {
    const store = makeStore({
      profileVisibility: vi.fn(async () => ({ blocked: true, muted: false })),
    })
    const page = await listProfileReplies(store, publishedContextsBinding(), 'user-1', null, 10, 'viewer-1', 'profile-test')
    expect(page).toEqual({ items: [], nextCursor: null, hasMore: false })
    expect(store.listReplies).not.toHaveBeenCalled()
  })

  it('scopes reply cursors to the author and current viewer before Store access', async () => {
    const store = makeStore({
      listReplies: vi.fn(async () => [reply({ id: 'c2' }), reply({ id: 'c1', created_at: '2026-10-14T10:00:00.000Z' })]),
    })
    const page = await listProfileReplies(store, publishedContextsBinding(), 'user-1', null, 1, 'viewer-1', 'profile-test')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))

    const untouched = makeStore()
    await expect(listProfileReplies(untouched, undefined, 'user-2', page.nextCursor, 1, 'viewer-1', 'profile-test'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileReplies(untouched, undefined, 'user-1', page.nextCursor, 1, 'viewer-2', 'profile-test'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(untouched.listReplies).not.toHaveBeenCalled()
  })

  it('fails closed when W03 cannot validate a reply parent content', async () => {
    const store = makeStore({ listReplies: vi.fn(async () => [reply()]) })
    await expect(listProfileReplies(store, undefined, 'user-1', null, 10, null, 'profile-test'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(store.listReplies).toHaveBeenCalledTimes(1)
  })

  it('validates liked-content visibility in one W03 batch and applies owner Block/Mute filtering', async () => {
    const store = makeStore({
      listLikedContents: vi.fn(async () => [liked('like-1', 'content-1', '2026-10-15T10:00:00.000Z')]),
    })
    const binding = publishedContextsBinding()
    await expect(listProfileLikedContents(store, binding, 'user-1', null, 10, 'viewer-2', 'profile-likes-test')).resolves.toEqual({
      items: [{ contentId: 'content-1', likedAt: '2026-10-15T10:00:00.000Z' }],
      nextCursor: null,
      hasMore: false,
    })
    expect(binding.fetch).toHaveBeenCalledTimes(1)
    const sent = binding.fetch.mock.calls[0]?.[0] as Request
    expect(sent.url).toContain('/internal/content/published-social-context-batch')
    expect(sent.headers.get('X-LuckRead-Caller')).toBe('W05')
    expect(sent.headers.has('Authorization')).toBe(false)
    expect(sent.headers.has('Cookie')).toBe(false)
    await expect(sent.json()).resolves.toEqual({ contentIds: ['content-1'] })
    expect(store.listLikedContents).toHaveBeenCalledWith({
      profileUserId: 'user-1', viewerUserId: 'viewer-2', cursor: null, limit: 11,
    })
    expect(store.listLikedContentBlockRelations).toHaveBeenCalledWith({
      principalUserIds: ['user-1', 'viewer-2'], ownerUserIds: ['owner-2'],
    })
    expect(store.listMutedOwners).toHaveBeenCalledWith({ viewerUserId: 'viewer-2', ownerUserIds: ['owner-2'] })
  })

  it('fails closed when W03 cannot validate a liked-content target', async () => {
    const store = makeStore({ listLikedContents: vi.fn(async () => [liked('like-1', 'content-1', '2026-10-15T10:00:00.000Z')]) })
    const binding = { fetch: vi.fn(async () => Response.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 })) }
    await expect(listProfileLikedContents(store, binding, 'user-1', null, 10, null, 'profile-likes-unavailable'))
      .rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it('filters unpublished, bidirectionally blocked and muted liked-content owners after W03 validation', async () => {
    const candidates = [
      liked('like-1', 'content-blocked', '2026-10-15T12:00:00.000Z'),
      liked('like-2', 'content-muted', '2026-10-15T11:00:00.000Z'),
      liked('like-3', 'content-unpublished', '2026-10-15T10:00:00.000Z'),
      liked('like-4', 'content-visible', '2026-10-15T09:00:00.000Z'),
    ]
    const blockRows: ProfileBlockRelationRow[] = [{ actor_user_id: 'user-1', target_user_id: 'owner-blocked' }]
    const store = makeStore({
      listLikedContents: vi.fn(async () => candidates),
      listLikedContentBlockRelations: vi.fn(async () => blockRows),
      listMutedOwners: vi.fn(async () => [{ target_user_id: 'owner-muted' }]),
    })
    const binding: W03ContentBinding & { fetch: ReturnType<typeof vi.fn> } = {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        const body = await request.json() as { contentIds: string[] }
        const ownerByContentId: Record<string, string | null> = {
          'content-blocked': 'owner-blocked',
          'content-muted': 'owner-muted',
          'content-unpublished': 'owner-missing',
          'content-visible': 'owner-visible',
        }
        return Response.json({ data: { items: body.contentIds
          .filter(contentId => contentId !== 'content-unpublished')
          .map(contentId => ({
            contentId,
            ownerUserId: ownerByContentId[contentId] ?? null,
            contentType: 'post',
            state: 'PUBLISHED',
            updatedAt: '2026-10-17T04:00:00.000Z',
          })) } })
      }),
    }
    const page = await listProfileLikedContents(store, binding, 'user-1', null, 10, 'viewer-2', 'profile-likes-visibility')
    expect(page.items).toEqual([{ contentId: 'content-visible', likedAt: '2026-10-15T09:00:00.000Z' }])
    expect(page.hasMore).toBe(false)
    expect(store.listLikedContentBlockRelations).toHaveBeenCalledWith({
      principalUserIds: ['user-1', 'viewer-2'],
      ownerUserIds: ['owner-blocked', 'owner-muted', 'owner-visible'],
    })
  })

  it('uses a profile- and viewer-scoped opaque likes cursor and validates limits before Store access', async () => {
    const store = makeStore({
      listLikedContents: vi.fn(async () => [
        liked('like-2', 'content-2', '2026-10-15T10:00:00.000Z'),
        liked('like-1', 'content-1', '2026-10-14T10:00:00.000Z'),
      ]),
    })
    const page = await listProfileLikedContents(store, publishedContextsBinding(), 'user-1', null, 1, 'viewer-1', 'profile-likes-cursor')
    expect(page.hasMore).toBe(true)
    expect(page.nextCursor).toEqual(expect.any(String))

    const untouched = makeStore()
    await expect(listProfileLikedContents(untouched, undefined, 'user-2', page.nextCursor, 1, 'viewer-1', 'profile-likes-cursor'))
      .rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    await expect(listProfileLikedContents(untouched, undefined, 'user-1', null, 51, null, 'profile-likes-cursor'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(untouched.listLikedContents).not.toHaveBeenCalled()
  })

  it('maps Store failures to a sanitized 503', async () => {
    const store = makeStore({
      listLikedContents: vi.fn(async () => { throw new ProfileChannelReadStoreError() }),
    })
    await expect(listProfileLikedContents(store, publishedContextsBinding(), 'user-1', null, 10, null, 'profile-store-error'))
      .rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
        message: 'PROFILE_CHANNEL_READ_UNAVAILABLE',
      })
  })
})
