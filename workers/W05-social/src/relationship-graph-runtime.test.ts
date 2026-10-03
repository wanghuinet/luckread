/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { getRelationshipGraph } from './relationship-graph-runtime.js'

const db = (result: unknown) => ({
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => result),
    })),
  })),
}) as unknown as D1Database

describe('relationship graph runtime', () => {
  it('derives mutual follow without creating another authoritative relation', async () => {
    const graph = await getRelationshipGraph(
      db({
        following: 1,
        followed_by: 1,
        relationship_id: 'r1',
        created_at: '2026-10-02T00:00:00.000Z',
        blocked: 0,
        blocked_by: 0,
        muted: 0,
      }),
      'viewer-1',
      'target-1',
    )

    expect(graph).toEqual({
      viewerUserId: 'viewer-1',
      targetUserId: 'target-1',
      following: true,
      followedBy: true,
      mutualFollow: true,
      blocked: false,
      blockedBy: false,
      muted: false,
      relationshipId: 'r1',
      createdAt: '2026-10-02T00:00:00.000Z',
    })
  })

  it('distinguishes inbound and outbound block/mute relations', async () => {
    const graph = await getRelationshipGraph(
      db({
        following: 1,
        followed_by: 0,
        relationship_id: 'r2',
        created_at: '2026-10-02T00:00:00.000Z',
        blocked: 0,
        blocked_by: 1,
        muted: 1,
      }),
      'viewer-1',
      'target-1',
    )

    expect(graph.following).toBe(true)
    expect(graph.followedBy).toBe(false)
    expect(graph.mutualFollow).toBe(false)
    expect(graph.blocked).toBe(false)
    expect(graph.blockedBy).toBe(true)
    expect(graph.muted).toBe(true)
  })

  it('hides follow relationship details when either side has blocked the other', async () => {
    const graph = await getRelationshipGraph(
      db({
        following: 1,
        followed_by: 1,
        relationship_id: 'r-blocked',
        created_at: '2026-10-02T00:00:00.000Z',
        blocked: 1,
        blocked_by: 0,
        muted: 0,
      }),
      'viewer-1',
      'target-1',
    )

    expect(graph).toMatchObject({
      following: false,
      followedBy: false,
      mutualFollow: false,
      blocked: true,
      blockedBy: false,
      relationshipId: null,
      createdAt: null,
    })
  })

  it('does not expose self as mutual or blocked relationship', async () => {
    const graph = await getRelationshipGraph(db(null), 'same-user', 'same-user')
    expect(graph.mutualFollow).toBe(false)
    expect(graph.blocked).toBe(false)
    expect(graph.blockedBy).toBe(false)
    expect(graph.muted).toBe(false)
    expect(graph.relationshipId).toBeNull()
    expect(graph.createdAt).toBeNull()
  })

  it('rejects invalid identifiers', async () => {
    await expect(getRelationshipGraph(db(null), ' ', 'target')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })
})
