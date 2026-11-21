import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearRelationshipGraphCacheForTests, getRelationshipGraph } from './relationship-graph-runtime.js'
import type { RelationshipGraphReadRow, RelationshipGraphReadStore } from './relationship-graph-store.js'
const graphStore = (result: RelationshipGraphReadRow | null): RelationshipGraphReadStore => ({ read: vi.fn(async () => result) })

describe('relationship graph runtime', () => {
  beforeEach(() => clearRelationshipGraphCacheForTests())
  it('derives mutual follow from one authoritative graph read', async () => {
    const store = graphStore({ following: 1, followed_by: 1, relationship_id: 'r1', created_at: '2026-10-02T00:00:00.000Z', blocked: 0, blocked_by: 0, muted: 0 })
    await expect(getRelationshipGraph(store, 'viewer-1', 'target-1')).resolves.toEqual({ viewerUserId: 'viewer-1', targetUserId: 'target-1', following: true, followedBy: true, mutualFollow: true, blocked: false, blockedBy: false, muted: false, relationshipId: 'r1', createdAt: '2026-10-02T00:00:00.000Z' })
    expect(store.read).toHaveBeenCalledWith('viewer-1', 'target-1')
  })
  it('distinguishes inbound/outbound Block and Mute state', async () => {
    const graph = await getRelationshipGraph(graphStore({ following: 1, followed_by: 0, relationship_id: 'r2', created_at: '2026-10-02T00:00:00.000Z', blocked: 0, blocked_by: 1, muted: 1 }), 'viewer-1', 'target-1')
    expect(graph).toMatchObject({ following: true, followedBy: false, mutualFollow: false, blocked: false, blockedBy: true, muted: true })
  })
  it('hides follow relationship details when either side has blocked the other', async () => {
    const graph = await getRelationshipGraph(graphStore({ following: 1, followed_by: 1, relationship_id: 'r-blocked', created_at: '2026-10-02T00:00:00.000Z', blocked: 1, blocked_by: 0, muted: 0 }), 'viewer-1', 'target-1')
    expect(graph).toMatchObject({ following: false, followedBy: false, mutualFollow: false, blocked: true, blockedBy: false, relationshipId: null, createdAt: null })
  })
  it('does not expose self as a relationship', async () => {
    const graph = await getRelationshipGraph(undefined, 'same-user', 'same-user')
    expect(graph).toMatchObject({ mutualFollow: false, blocked: false, blockedBy: false, muted: false, relationshipId: null, createdAt: null })
  })
  it('serves repeated reads from the private cache', async () => {
    const first = graphStore({ following: 1, followed_by: 0, relationship_id: 'cache-r1', created_at: '2026-10-02T00:00:00.000Z', blocked: 0, blocked_by: 0, muted: 0 })
    await expect(getRelationshipGraph(first, 'cache-user', 'cache-target')).resolves.toMatchObject({ following: true, relationshipId: 'cache-r1' })
    const secondRead = vi.fn(async () => { throw new Error('STORE_SHOULD_NOT_BE_READ') })
    await expect(getRelationshipGraph({ read: secondRead }, 'cache-user', 'cache-target')).resolves.toMatchObject({ following: true, relationshipId: 'cache-r1' })
    expect(secondRead).not.toHaveBeenCalled()
  })
  it('fails closed when the graph Store is not composed', async () => {
    await expect(getRelationshipGraph(undefined, 'viewer-1', 'target-1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
  it('rejects invalid identifiers before Store access', async () => {
    const read = vi.fn(async () => null)
    await expect(getRelationshipGraph({ read }, ' ', 'target')).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 })
    expect(read).not.toHaveBeenCalled()
  })
})
