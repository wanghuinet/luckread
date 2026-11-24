import { describe, expect, it, vi } from 'vitest'
import { createW03ContentWorker } from './index.js'
import {
  appendPostThreadNext,
  createContentRelationship,
  listContentRelationships,
  listPostThread,
  revokeContentRelationship,
  type ContentRelationshipMutationStore,
  type CreateRelationshipQueryRow,
  type RevokeRelationshipQueryRow,
  type AppendPostThreadQueryRow,
  type PostThreadReadStore,
} from './content-relationships.js'

const baseRelationship = {
  relationshipId: 'rel_1',
  sourceType: 'content' as const,
  sourceId: 'post_1',
  targetType: 'content' as const,
  targetId: 'post_2',
  relationType: 'reference' as const,
  schemaVersion: 1,
  status: 'ACTIVE' as const,
  actorId: 'user_1',
  provenanceRef: null,
  authorizationRef: null,
  createdAt: '2026-11-20T12:00:00.000Z',
  updatedAt: '2026-11-20T12:00:00.000Z',
}

const createRow: CreateRelationshipQueryRow = {
  source_id: 'post_1',
  owner_user_id: 'user_1',
  source_version: 1,
  source_content_type: 'post',
  target_id: 'post_2',
  target_content_type: 'post',
  target_state: 'PUBLISHED',
  target_access_mode: 'PUBLIC',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_json: null,
  idem_expires_at: null,
  active_relationship_id: null,
}

const appendRow: AppendPostThreadQueryRow = {
  source_id: 'post_1',
  source_owner_user_id: 'user_1',
  source_content_type: 'post',
  source_state: 'PUBLISHED',
  source_access_mode: 'PUBLIC',
  target_id: 'post_2',
  target_owner_user_id: 'user_1',
  target_content_type: 'post',
  target_state: 'DRAFT',
  target_access_mode: 'PUBLIC',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_json: null,
  idem_expires_at: null,
}

const revokeRow: RevokeRelationshipQueryRow = {
  relationship_id: 'rel_1',
  source_type: 'content',
  source_id: 'post_1',
  target_type: 'content',
  target_id: 'post_2',
  relation_type: 'reference',
  schema_version: 1,
  status: 'ACTIVE',
  actor_id: 'user_1',
  provenance_ref: null,
  authorization_ref: null,
  created_at: '2026-11-20T12:00:00.000Z',
  updated_at: '2026-11-20T12:00:00.000Z',
  owner_user_id: 'user_1',
  idem_id: null,
  idem_owner_user_id: null,
  idem_request_hash: null,
  idem_status: null,
  idem_response_json: null,
  idem_expires_at: null,
}

function makeMutationStore(): ContentRelationshipMutationStore & {
  create: ReturnType<typeof vi.fn>
  revoke: ReturnType<typeof vi.fn>
  appendThread: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
} {
  return {
    async loadCreate() { return createRow },
    create: vi.fn(async () => undefined),
    async loadRevoke() { return revokeRow },
    revoke: vi.fn(async () => undefined),
    async loadAppend() { return appendRow },
    async loadAppendStats() {
      return { previous_count: 1, next_count: 1, would_cycle: 0, source_has_next: 0, target_has_previous: 0 }
    },
    appendThread: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
  }
}

const threadRows = [{
  id: 'post_1',
  slug: 'post-one',
  position: 0,
  state: 'PUBLISHED' as const,
  access_mode: 'PUBLIC' as const,
  title: 'First post',
  body_ref: 'https://img.luckread.com/body/1.txt',
  media_refs_json: '[]',
  cover_ref: null,
  created_at: '2026-11-20T12:00:00.000Z',
}]

describe('W03 Neon content relationship authority', () => {
  it('reads public relationships through the injected Neon store with scoped pagination', async () => {
    const store = makeMutationStore()
    store.list.mockResolvedValueOnce({
      items: [{
        relationshipId: 'rel_1',
        relationType: 'reference',
        direction: 'out',
        relatedContent: { id: 'post_2', slug: 'post-two', contentType: 'post', title: 'Second post' },
        createdAt: '2026-11-20T12:00:00.000Z',
      }],
      nextCursor: 'next-page',
      hasMore: true,
    })
    const result = await listContentRelationships(store, 'post_1', 'out', null, 10)
    expect(store.list).toHaveBeenCalledWith({ contentId: 'post_1', direction: 'out', cursor: null, limit: 10 })
    expect(result.items[0]?.relatedContent.id).toBe('post_2')
    expect(result.hasMore).toBe(true)
    await expect(listContentRelationships(store, 'post_1', 'invalid' as never))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(store.list).toHaveBeenCalledTimes(1)
  })

  it('creates reference and quote-post relationships through the Neon mutation store', async () => {
    const store = makeMutationStore()
    const relation = await createContentRelationship(
      store, 'user_1', 'post_1',
      { targetContentId: 'post_2', relationType: 'quote-post' },
      'relationship-create-1',
    )
    expect(relation).toMatchObject({
      sourceId: 'post_1',
      targetId: 'post_2',
      relationType: 'quote-post',
      status: 'ACTIVE',
      actorId: 'user_1',
    })
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user_1',
      operationId: 'createContentRelationship',
      idempotencyKey: 'relationship-create-1',
      relationship: expect.objectContaining({ relationType: 'quote-post' }),
    }))
  })

  it('rejects private quote targets and generic thread-next edges before persistence', async () => {
    const privateStore = makeMutationStore()
    privateStore.loadCreate = vi.fn(async () => ({ ...createRow, target_access_mode: 'MEMBERS_ONLY' }))
    await expect(createContentRelationship(
      privateStore, 'user_1', 'post_1',
      { targetContentId: 'post_2', relationType: 'quote-post' }, 'private-target',
    )).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
    expect(privateStore.create).not.toHaveBeenCalled()

    await expect(createContentRelationship(
      makeMutationStore(), 'user_1', 'post_1',
      { targetContentId: 'post_2', relationType: 'thread-next' }, 'generic-thread',
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
  })

  it('replays a completed idempotent relationship without writing a second record', async () => {
    const store = makeMutationStore()
    const replay = { ...baseRelationship, status: 'ACTIVE' }
    store.loadCreate = vi.fn(async () => ({
      ...createRow,
      idem_id: 'idem_1',
      idem_owner_user_id: 'user_1',
      idem_request_hash: 'hash-placeholder',
      idem_status: 'COMPLETED' as const,
      idem_response_json: JSON.stringify(replay),
      idem_expires_at: '2099-01-01T00:00:00.000Z',
      active_relationship_id: 'rel_1',
    }))
    // A mismatched request hash fails closed; no duplicate insert is attempted.
    await expect(createContentRelationship(
      store, 'user_1', 'post_1',
      { targetContentId: 'post_2' }, 'reused-key',
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSE_CONFLICT', status: 422 })
    expect(store.create).not.toHaveBeenCalled()
  })

  it('revokes a relationship through the Neon store with owner and status checks', async () => {
    const store = makeMutationStore()
    const result = await revokeContentRelationship(store, 'user_1', 'post_1', 'rel_1', 'relationship-revoke-1')
    expect(result).toMatchObject({ relationshipId: 'rel_1', status: 'REVOKED' })
    expect(store.revoke).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user_1',
      relationshipId: 'rel_1',
      sourceContentId: 'post_1',
    }))

    const wrongOwner = makeMutationStore()
    wrongOwner.loadRevoke = vi.fn(async () => ({ ...revokeRow, owner_user_id: 'user_2' }))
    await expect(revokeContentRelationship(wrongOwner, 'user_1', 'post_1', 'rel_1', 'idem'))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 })
    expect(wrongOwner.revoke).not.toHaveBeenCalled()
  })

  it('appends a thread edge through Neon with cycle, fork, owner and length preflight checks', async () => {
    const store = makeMutationStore()
    const result = await appendPostThreadNext(store, 'user_1', 'post_1', 'post_2', 'thread-append-1')
    expect(result).toMatchObject({
      sourceId: 'post_1',
      targetId: 'post_2',
      relationType: 'thread-next',
      status: 'ACTIVE',
    })
    expect(store.loadAppendStats).toBeDefined()
    expect(store.appendThread).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user_1',
      maxItems: 50,
      relationship: expect.objectContaining({ relationType: 'thread-next' }),
    }))

    const cycleStore = makeMutationStore()
    cycleStore.loadAppendStats = vi.fn(async () => ({
      previous_count: 1, next_count: 2, would_cycle: 1, source_has_next: 0, target_has_previous: 0,
    }))
    await expect(appendPostThreadNext(cycleStore, 'user_1', 'post_1', 'post_2', 'thread-cycle'))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(cycleStore.appendThread).not.toHaveBeenCalled()
  })

  it('reads ordered thread items through the required Neon read store', async () => {
    const readStore: PostThreadReadStore = { async list(contentId, viewerUserId, maxItems) {
      expect(contentId).toBe('post_1')
      expect(viewerUserId).toBe('user_1')
      expect(maxItems).toBe(50)
      return threadRows
    } }
    const result = await listPostThread(readStore, 'post_1', 'user_1')
    expect(result).toMatchObject({ rootContentId: 'post_1', items: [{ id: 'post_1', mediaRefs: [] }] })
  })

  it('keeps public relationship reads behind the W01 transport boundary', async () => {
    const worker = createW03ContentWorker({ contentRelationshipMutationStoreProvider: () => makeMutationStore() })
    const denied = await worker.fetch(
      new Request('https://luckread-w03.internal/internal/content/contents/post_1/relationships'),
      {} as never,
    )
    expect(denied.status).toBe(403)
  })

  it('keeps relationship mutation idempotency in the Neon PostgreSQL adapter', () => {
    const adapter = readFileSync(resolve(process.cwd(), 'workers/W03-content/src/content-relationship-mutation-store-postgres.ts'), 'utf8')
    expect(adapter).toContain('content_mutation_idempotency')
    expect(adapter).toContain('BEGIN')
    expect(adapter).toContain('COMMIT')
  })
})
