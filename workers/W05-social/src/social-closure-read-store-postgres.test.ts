import { describe, expect, it } from 'vitest'

import { SocialClosureReadStoreError } from './social-closure-read-store.js'
import { createPostgresSocialClosureReadStore } from './social-closure-read-store-postgres.js'

function fakePostgres(options: {
  rows?: Record<string, unknown>[]
  fail?: boolean
} = {}) {
  const calls: Array<{ sql: string; values: unknown[] }> = []
  const db = {
    async query<Row>(sql: string, values: unknown[] = []) {
      calls.push({ sql, values })
      if (options.fail) throw new Error('secret-driver-detail')
      return { rows: (options.rows ?? []) as Row[] }
    },
  }
  return { db, calls }
}

describe('W05 PostgreSQL social closure read store', () => {
  it('uses the bounded keyset topic-page and active discovery queries', async () => {
    const topic = {
      topic_id: 'topic-reading',
      normalized_name: 'reading',
      display_name: 'Reading',
      status: 'ACTIVE',
    }
    const edge = { target_id: 'content-2', created_at: '2026-11-10T00:00:00.000Z' }
    const discoveryEdge = {
      topic_id: 'topic-reading',
      normalized_name: 'reading',
      display_name: 'Reading',
      target_id: 'content-2',
    }
    const { db, calls } = fakePostgres({ rows: [topic, edge, discoveryEdge] })
    const store = createPostgresSocialClosureReadStore(db)

    await expect(store.getTopicByName('reading')).resolves.toEqual(topic)
    await expect(store.listTopicContentEdges({
      topicId: 'topic-reading',
      cursor: { createdAt: '2026-11-09T00:00:00.000Z', targetId: 'content-9' },
      limit: 50,
    })).resolves.toEqual([edge])
    await expect(store.listDiscoveryContentEdges({
      cursor: { topicId: 'topic-old', targetId: 'content-old' },
      limit: 200,
    })).resolves.toEqual([discoveryEdge])

    expect(calls[0]?.sql).toContain('WHERE normalized_name = $1')
    expect(calls[1]?.sql).toContain('st.target_type = \'content\'')
    expect(calls[1]?.sql).toContain('(st.created_at, st.target_id) < ($2::timestamptz, $3::text)')
    expect(calls[1]?.sql).toContain('ORDER BY st.created_at DESC, st.target_id DESC')
    expect(calls[1]?.values).toEqual(['topic-reading', '2026-11-09T00:00:00.000Z', 'content-9', 50])
    expect(calls[2]?.sql).toContain("t.status = 'ACTIVE'")
    expect(calls[2]?.sql).toContain('(st.topic_id, st.target_id) > ($1::text, $2::text)')
    expect(calls[2]?.sql).toContain('ORDER BY st.topic_id ASC, st.target_id ASC')
    expect(calls[2]?.values).toEqual(['topic-old', 'content-old', 200])
  })

  it('keeps inbox pagination and unread count actor-scoped, and supports single/all read updates', async () => {
    const row = {
      notification_id: 'notification-1',
      notification_type: 'COMMENT',
      actor_user_id: 'actor-1',
      target_type: 'content',
      target_id: 'content-1',
      payload_json: '{"contentId":"content-1"}',
      read_at: null,
      created_at: '2026-11-10T00:00:00.000Z',
    }
    const { db, calls } = fakePostgres({ rows: [row] })
    const store = createPostgresSocialClosureReadStore(db)

    await expect(store.listNotificationRows({
      recipientUserId: 'recipient-1',
      notificationType: 'COMMENT',
      notificationId: 'notification-1',
      cursor: { createdAt: '2026-11-09T00:00:00.000Z', notificationId: 'notification-2' },
      limit: 21,
    })).resolves.toEqual([row])
    expect(calls[0]?.sql).toContain('recipient_user_id = $1')
    expect(calls[0]?.sql).toContain('notification_type = $2')
    expect(calls[0]?.sql).toContain('notification_id = $3')
    expect(calls[0]?.sql).toContain('(created_at, notification_id) < ($4::timestamptz, $5::text)')
    expect(calls[0]?.sql).toContain('ORDER BY created_at DESC, notification_id DESC')
    expect(calls[0]?.values).toEqual([
      'recipient-1', 'COMMENT', 'notification-1', '2026-11-09T00:00:00.000Z', 'notification-2', 21,
    ])

    await expect(store.countUnreadNotifications('recipient-1')).resolves.toBe(1)
    expect(calls[1]?.values).toEqual(['recipient-1'])
    await expect(store.markNotificationRead('recipient-1', 'notification-1')).resolves.toBeUndefined()
    expect(calls[2]?.values).toEqual(['notification-1', 'recipient-1'])
    await expect(store.markAllNotificationsRead('recipient-1')).resolves.toBeUndefined()
    expect(calls[3]?.values).toEqual(['recipient-1'])
  })

  it('reads content social counts and viewer state without crossing W03 authority', async () => {
    const counts = { likes: 3, comments: 2, favorites: 1, shares: 4, reposts: 7, pinned: true }
    const viewer = { liked: true, favorited: false, reposted: true }
    const calls: Array<{ sql: string; values: unknown[] }> = []
    const db = {
      async query<Row>(sql: string, values: unknown[] = []) {
        calls.push({ sql, values })
        return { rows: [calls.length === 1 ? counts : viewer] as Row[] }
      },
    }
    const store = createPostgresSocialClosureReadStore(db)

    await expect(store.getContentSocialCounts('content-1', 'owner-1')).resolves.toEqual(counts)
    await expect(store.getContentSocialViewerState('viewer-1', 'content-1')).resolves.toEqual(viewer)
    expect(calls[0]?.sql).toContain('FROM interaction_likes')
    expect(calls[0]?.sql).toContain('FROM social_comments')
    expect(calls[0]?.sql).toContain('FROM interaction_favorites')
    expect(calls[0]?.sql).toContain('FROM social_share_links')
    expect(calls[0]?.sql).toContain('FROM social_reposts')
    expect(calls[0]?.sql).toContain('FROM social_profile_pins')
    expect(calls[0]?.sql).not.toMatch(/(?:FROM|JOIN)\s+contents\b/i)
    expect(calls[1]?.sql).toContain('AS liked')
    expect(calls[1]?.sql).toContain('AS favorited')
    expect(calls[1]?.sql).toContain('AS reposted')
    expect(calls[0]?.values).toEqual(['content-1','content-1','content-1','content-1','content-1','content-1','owner-1'])
    expect(calls[1]?.values).toEqual(['viewer-1','content-1','viewer-1','content-1','viewer-1','content-1'])
  })

  it('sanitizes PostgreSQL failures for each read boundary', async () => {
    const { db } = fakePostgres({ fail: true })
    const store = createPostgresSocialClosureReadStore(db)
    await expect(store.getTopicByName('reading')).rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.listTopicContentEdges({ topicId: 'topic-1', cursor: null, limit: 50 }))
      .rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.listDiscoveryContentEdges({ cursor: null, limit: 200 }))
      .rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.listNotificationRows({
      recipientUserId: 'recipient-1', notificationType: null, notificationId: null, cursor: null, limit: 21,
    })).rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.countUnreadNotifications('recipient-1')).rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.markNotificationRead('recipient-1', 'notification-1'))
      .rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.markAllNotificationsRead('recipient-1')).rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.getContentSocialCounts('content-1', null)).rejects.toBeInstanceOf(SocialClosureReadStoreError)
    await expect(store.getContentSocialViewerState('viewer-1', 'content-1'))
      .rejects.toBeInstanceOf(SocialClosureReadStoreError)
  })
})
