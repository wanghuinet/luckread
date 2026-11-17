import { describe, expect, it, vi } from 'vitest'
import { getRelation, listRelations, removeRelation, setRelation } from './block-mute-runtime.js'
import type { BlockMuteListReadRow, BlockMuteListReadStore } from './block-mute-list-read-store.js'
import type { BlockMuteRelationLookup, BlockMuteRelationRow, BlockMuteRelationStore, BlockMuteRelationUpsert } from './block-mute-relation-store.js'

const key = (actor: string, target: string, type: string) => actor + '\0' + target + '\0' + type
function memoryRelationStore(initial: readonly BlockMuteRelationRow[] = []): BlockMuteRelationStore {
  const rows = new Map(initial.map((row) => [key(row.actor_user_id, row.target_user_id, row.relation_type), row]))
  return {
    get: vi.fn(async (input: BlockMuteRelationLookup) => rows.get(key(input.actorUserId, input.targetUserId, input.relationType)) ?? null),
    set: vi.fn(async (input: BlockMuteRelationUpsert) => {
      const k = key(input.actorUserId, input.targetUserId, input.relationType)
      const row = rows.get(k) ?? { relationship_id: input.relationshipId, actor_user_id: input.actorUserId, target_user_id: input.targetUserId, relation_type: input.relationType, created_at: input.createdAt, updated_at: input.updatedAt }
      rows.set(k, row)
      return row
    }),
    remove: vi.fn(async (input: BlockMuteRelationLookup) => { rows.delete(key(input.actorUserId, input.targetUserId, input.relationType)) }),
  }
}
const relationRow: BlockMuteRelationRow = { relationship_id: 'block-read-1', actor_user_id: 'user-1', target_user_id: 'target-1', relation_type: 'block', created_at: '2026-10-02T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' }

describe('block/mute runtime', () => {
  it('reads a relation through the injected Store', async () => {
    const store = memoryRelationStore([relationRow])
    await expect(getRelation(store, 'user-1', 'target-1', 'block')).resolves.toMatchObject({ relationshipId: 'block-read-1', relationType: 'block' })
    expect(store.get).toHaveBeenCalledWith({ actorUserId: 'user-1', targetUserId: 'target-1', relationType: 'block' })
  })
  it('converges repeated sets through the authoritative upsert', async () => {
    const store = memoryRelationStore()
    const first = await setRelation(store, 'user-1', 'target-1', 'block')
    expect(await setRelation(store, 'user-1', 'target-1', 'block')).toEqual(first)
  })
  it('keeps Block and Mute independent', async () => {
    const store = memoryRelationStore()
    const block = await setRelation(store, 'user-1', 'target-1', 'block')
    const mute = await setRelation(store, 'user-1', 'target-1', 'mute')
    expect(block.relationType).toBe('block')
    expect(mute.relationType).toBe('mute')
    await expect(getRelation(store, 'user-1', 'target-1', 'block')).resolves.toMatchObject({ relationshipId: block.relationshipId })
    await expect(getRelation(store, 'user-1', 'target-1', 'mute')).resolves.toMatchObject({ relationshipId: mute.relationshipId })
  })
  it('rejects self relation and malformed ids before Store access', async () => {
    const store = memoryRelationStore()
    await expect(setRelation(store, 'user-1', 'user-1', 'block')).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 })
    await expect(setRelation(store, 'bad id', 'target-1', 'block')).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 })
    expect(store.set).not.toHaveBeenCalled()
  })
  it('removes relations idempotently through the injected Store', async () => {
    const store = memoryRelationStore([relationRow])
    await removeRelation(store, 'user-1', 'target-1', 'block')
    await removeRelation(store, 'user-1', 'target-1', 'block')
    expect(store.remove).toHaveBeenCalledTimes(2)
  })
  it('fails closed when the relation Store is not composed', async () => {
    await expect(setRelation(undefined, 'user-1', 'target-1', 'block')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})

describe('block/mute relation lists', () => {
  it('returns a bounded page and actor/type-scoped cursor', async () => {
    const rows: BlockMuteListReadRow[] = [
      { relationship_id: 'block-2', target_user_id: 'target-2', created_at: '2026-10-18T00:00:00.000Z' },
      { relationship_id: 'block-1', target_user_id: 'target-1', created_at: '2026-10-17T00:00:00.000Z' },
    ]
    const store: BlockMuteListReadStore = { list: vi.fn(async () => rows) }
    const page = await listRelations(store, 'viewer-1', 'block', null, 1)
    expect(page).toMatchObject({ items: [{ relationshipId: 'block-2', targetUserId: 'target-2' }], hasMore: true, nextCursor: expect.any(String) })
    expect(store.list).toHaveBeenCalledWith({ actorUserId: 'viewer-1', relationType: 'block', cursor: null, limit: 1 })
  })
  it('rejects another actor cursor before querying the Store', async () => {
    const store: BlockMuteListReadStore = { list: vi.fn(async () => []) }
    const cursor = btoa(JSON.stringify({ version: 1, actorUserId: 'someone-else', relationType: 'block', createdAt: '2026-10-17T00:00:00.000Z', relationshipId: 'block-1' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    await expect(listRelations(store, 'viewer-1', 'block', cursor, 20)).rejects.toMatchObject({ code: 'INVALID_CURSOR', status: 400 })
    expect(store.list).not.toHaveBeenCalled()
  })
  it('fails closed when the list Store is not composed', async () => {
    await expect(listRelations(undefined, 'viewer-1', 'mute', null, 20)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
