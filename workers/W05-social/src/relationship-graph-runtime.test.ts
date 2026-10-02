/// <reference types="@cloudflare/workers-types" />
import { describe, expect, it, vi } from 'vitest'
import { getRelationshipGraph } from './relationship-graph-runtime.js'

const db = (results: unknown[]) => ({
  prepare: vi.fn(() => ({
    bind: vi.fn(() => ({
      all: vi.fn(async () => ({ results })),
    })),
  })),
}) as unknown as D1Database

describe('relationship graph runtime', () => {
  it('derives mutual follow without creating another authoritative relation', async () => {
    const graph = await getRelationshipGraph(
      db([
        { relation_kind: 'follow_out', relation_type: 'follow' },
        { relation_kind: 'follow_in', relation_type: 'follow' },
      ]),
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
    })
  })

  it('distinguishes inbound and outbound block/mute relations', async () => {
    const graph = await getRelationshipGraph(
      db([
        { relation_kind: 'block_in', relation_type: 'block' },
        { relation_kind: 'mute_out', relation_type: 'mute' },
        { relation_kind: 'follow_out', relation_type: 'follow' },
      ]),
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

  it('does not expose self as mutual or blocked relationship', async () => {
    const graph = await getRelationshipGraph(db([]), 'same-user', 'same-user')
    expect(graph.mutualFollow).toBe(false)
    expect(graph.blocked).toBe(false)
    expect(graph.blockedBy).toBe(false)
    expect(graph.muted).toBe(false)
  })

  it('rejects invalid identifiers', async () => {
    await expect(getRelationshipGraph(db([]), ' ', 'target')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    })
  })
})
