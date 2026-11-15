import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { FollowStore } from './follow-store.js'
import type { NotificationEnqueueInput, NotificationEnqueueStore } from './notification-enqueue-store.js'

const actorUserId = 'follow-actor-1'
const targetUserId = 'follow-target-1'

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-follow-notification-test',
  'X-LuckRead-Principal-User-Id': actorUserId,
  'X-LuckRead-Principal-Layer': 'L2',
}

function createHarness() {
  const followStore: FollowStore = {
    follow: vi.fn(async (input) => ({
      relationship_id: input.relationshipId,
      follower_user_id: input.followerUserId,
      target_user_id: input.targetUserId,
      created_at: input.createdAt,
    })),
    unfollow: vi.fn(async () => undefined),
  }
  const enqueued: NotificationEnqueueInput[] = []
  const notificationEnqueueStore: NotificationEnqueueStore = {
    enqueue: vi.fn(async (input) => { enqueued.push(input) }),
  }
  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon Follow path')
  })
  const worker = createW05SocialWorker({ followStore, notificationEnqueueStore })

  return {
    worker,
    env: { DB: { prepare } },
    prepare,
    followStore,
    notificationEnqueueStore,
    enqueued,
  }
}

describe('W05 Neon Follow route composition', () => {
  it('writes the follow and its notification through PostgreSQL stores without D1 access', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request(`https://luckread-w05.internal/internal/social/follows/${targetUserId}`, {
        method: 'POST',
        headers: {
          ...transportHeaders,
          'Idempotency-Key': 'follow-neon-idempotency-1',
        },
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        following: true,
        targetUserId,
        relationshipId: expect.any(String),
      },
    })
    expect(h.followStore.follow).toHaveBeenCalledWith(expect.objectContaining({
      followerUserId: actorUserId,
      targetUserId,
    }))
    expect(h.notificationEnqueueStore.enqueue).toHaveBeenCalledTimes(1)
    expect(h.enqueued[0]).toMatchObject({
      recipientUserId: targetUserId,
      actorUserId,
      notificationType: 'FOLLOW',
      targetType: 'user',
      targetId: targetUserId,
      dedupeKey: `FOLLOW:${targetUserId}:${actorUserId}:user:${targetUserId}`,
    })
    expect(h.enqueued[0]?.notificationId).toEqual(expect.any(String))
    expect(h.prepare).not.toHaveBeenCalled()
  })
})
