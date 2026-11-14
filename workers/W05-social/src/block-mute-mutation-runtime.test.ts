import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { BlockMuteRelationRow, BlockMuteRelationStore } from './block-mute-relation-store.js'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-block-mute-test',
  'X-LuckRead-Principal-User-Id': 'viewer-block-mute-1',
  'X-LuckRead-Principal-Layer': 'L2',
}

function createHarness() {
  const now = '2026-11-14T00:00:00.000Z'
  const store: BlockMuteRelationStore = {
    get: vi.fn(async () => null),
    set: vi.fn(async (input) => ({
      relationship_id: 'relation-pg-1',
      actor_user_id: input.actorUserId,
      target_user_id: input.targetUserId,
      relation_type: input.relationType,
      created_at: now,
      updated_at: now,
    } satisfies BlockMuteRelationRow)),
    remove: vi.fn(async () => undefined),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Block/Mute path')
  })
  const worker = createW05SocialWorker({ blockMuteRelationStore: store })
  return {
    worker,
    env: { DB: { prepare } },
    prepare,
    store,
  }
}

describe('W05 Neon Block/Mute mutation route composition', () => {
  it('creates a Mute through PostgreSQL and keeps D1 untouched', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/mutes', {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'content-type': 'application/json',
          'Idempotency-Key': 'mute-create-idempotency-1',
        },
        body: JSON.stringify({ targetUserId: 'muted-user-1' }),
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        relationshipId: 'relation-pg-1',
        actorUserId: 'viewer-block-mute-1',
        targetUserId: 'muted-user-1',
        relationType: 'mute',
      },
    })
    expect(h.store.set).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'viewer-block-mute-1',
      targetUserId: 'muted-user-1',
      relationType: 'mute',
    }))
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('deletes a Block through PostgreSQL and keeps D1 untouched', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/interactions/blocks/blocked-user-1', {
        method: 'DELETE',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'block-delete-idempotency-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.store.remove).toHaveBeenCalledWith({
      actorUserId: 'viewer-block-mute-1',
      targetUserId: 'blocked-user-1',
      relationType: 'block',
    })
    expect(h.prepare).not.toHaveBeenCalled()
  })
})
