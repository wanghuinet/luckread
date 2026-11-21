import { describe, expect, it, vi } from 'vitest'

import { createW05SocialWorker } from './index.js'
import type { NotificationInboxListInput, NotificationInboxRow, SocialClosureReadStore } from './social-closure-read-store.js'

const recipientUserId = 'notification-recipient-1'
const notification: NotificationInboxRow = {
  notification_id: 'notification-neon-1',
  notification_type: 'FOLLOW',
  actor_user_id: 'notification-actor-1',
  target_type: 'user',
  target_id: recipientUserId,
  payload_json: '{}',
  read_at: null,
  created_at: '2026-11-15T00:00:00.000Z',
}

const transportHeaders = {
  'X-LuckRead-Caller': 'W01',
  'X-LuckRead-Transport-Version': '1.0',
  'X-LuckRead-Correlation-Id': 'w05-neon-notification-inbox-test',
  'X-LuckRead-Principal-User-Id': recipientUserId,
  'X-LuckRead-Principal-Layer': 'L2',
}

function createHarness() {
  const listInput: NotificationInboxListInput[] = []
  const socialClosureReadStore: SocialClosureReadStore = {
    getTargets: vi.fn(async () => ({ topics: [], mentions: [] })),
    getTopicByName: vi.fn(async () => null),
    listTopicContentEdges: vi.fn(async () => []),
    listDiscoveryContentEdges: vi.fn(async () => []),
    listNotificationRows: vi.fn(async (input) => {
      listInput.push(input)
      return [notification]
    }),
    countUnreadNotifications: vi.fn(async () => 3),
    markNotificationRead: vi.fn(async () => undefined),
    markAllNotificationsRead: vi.fn(async () => undefined),
    getContentSocialCounts: vi.fn(async () => null),
    getContentSocialViewerState: vi.fn(async () => null),
  }

  const prepare = vi.fn(() => {
    throw new Error('D1 must not be accessed by the injected Neon notification inbox path')
  })
  const worker = createW05SocialWorker({ socialClosureReadStore })

  return { worker, env: { DB: { prepare } }, prepare, socialClosureReadStore, listInput }
}

describe('W05 Neon notification inbox route composition', () => {
  it('lists notifications and unread count through PostgreSQL without touching D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/notifications?limit=10&type=FOLLOW', {
        method: 'GET',
        headers: transportHeaders,
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      data: {
        items: [{
          id: notification.notification_id,
          type: 'FOLLOW',
          actorUserId: notification.actor_user_id,
          targetType: 'user',
          targetId: recipientUserId,
          payload: {},
          readAt: null,
        }],
        unreadCount: 3,
        hasMore: false,
        nextCursor: null,
      },
    })
    expect(h.listInput).toEqual([{
      recipientUserId,
      notificationType: 'FOLLOW',
      notificationId: null,
      cursor: null,
      limit: 11,
    }])
    expect(h.socialClosureReadStore.countUnreadNotifications).toHaveBeenCalledWith(recipientUserId)
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('marks one notification read through PostgreSQL without touching D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/notifications/notification-neon-1/read', {
        method: 'PATCH',
        headers: transportHeaders,
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.socialClosureReadStore.markNotificationRead).toHaveBeenCalledWith(
      recipientUserId,
      notification.notification_id,
    )
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('marks all notifications read through PostgreSQL without touching D1', async () => {
    const h = createHarness()
    const response = await h.worker.fetch(
      new Request('https://luckread-w05.internal/internal/social/notifications/read-all', {
        method: 'POST',
        headers: transportHeaders,
      }),
      h.env as never,
      {} as never,
    )

    expect(response.status).toBe(204)
    expect(h.socialClosureReadStore.markAllNotificationsRead).toHaveBeenCalledWith(recipientUserId)
    expect(h.prepare).not.toHaveBeenCalled()
  })
})
