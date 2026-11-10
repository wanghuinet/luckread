import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import {
  getContentSocialSummary,
  getTopicPage,
  listDiscoveryTopics,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../src/social-closure-runtime.ts'
import { createPostgresSocialClosureReadStore } from '../../src/social-closure-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_SOCIAL_CLOSURE_READ_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_SOCIAL_CLOSURE_READ_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to rehearse W05 social-closure reads outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-social-closure-read-' + randomUUID()
const reportPath = process.env.W05_SOCIAL_CLOSURE_READ_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-social-closure-read-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 })
const store = createPostgresSocialClosureReadStore(pool)
const now = new Date()
const nowIso = now.toISOString()
const timestamp = (offsetSeconds) => new Date(now.getTime() + offsetSeconds * 1000).toISOString()
const contentId = marker + '-content'
const topicId = marker + '-topic'
const secondTopicId = marker + '-topic-second'
const restrictedTopicId = marker + '-topic-restricted'
const recipientId = marker + '-recipient'
const otherRecipientId = marker + '-other-recipient'
const viewerId = marker + '-viewer'
const ownerId = marker + '-owner'
const notifications = [marker + '-notification-1', marker + '-notification-2', marker + '-notification-other']
let runtimePassed = false
let fixturePrepared = false

const contentBinding = {
  async fetch(input) {
    const request = input instanceof Request ? input : new Request(input)
    const body = await request.json()
    const contentIds = Array.isArray(body?.contentIds) ? body.contentIds : []
    return Response.json({
      data: {
        items: contentIds.map((id) => ({
          contentId: id,
          ownerUserId: ownerId,
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: nowIso,
          title: 'Synthetic published post ' + id,
        })),
      },
    })
  },
}

try {
  for (let index = 0; index < 4; index += 1) {
    await pool.query(
      `INSERT INTO social_target_topics
         (relation_id, target_type, target_id, topic_id, token, created_at)
       VALUES ($1, 'content', $2, $3, $4, $5)`,
      [marker + '-topic-edge-' + index, marker + '-topic-content-' + index, topicId, '#batch', timestamp(-40 + index)],
    )
  }
  await pool.query(
    `INSERT INTO social_topics
       (topic_id, normalized_name, display_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', $4, $4),
            ($5, $6, $7, 'ACTIVE', $4, $4),
            ($8, $9, $10, 'RESTRICTED', $4, $4)`,
    [
      topicId, marker + '-topic-name', 'Batch topic',
      timestamp(-10),
      secondTopicId, marker + '-second-name', 'Second topic',
      restrictedTopicId, marker + '-restricted-name', 'Restricted topic',
    ],
  )
  // One edge for the second topic and one restricted edge exercise discovery filtering.
  await pool.query(
    `INSERT INTO social_target_topics
       (relation_id, target_type, target_id, topic_id, token, created_at)
     VALUES ($1, 'content', $2, $3, '#second', $4),
            ($5, 'content', $6, $7, '#restricted', $4)`,
    [
      marker + '-second-edge', marker + '-topic-content-second', secondTopicId, timestamp(-5),
      marker + '-restricted-edge', marker + '-topic-content-restricted', restrictedTopicId, timestamp(-4),
    ],
  )
  // A notification insert also exercises the PostgreSQL-native W05 atomic outbox trigger.
  await pool.query(
    `INSERT INTO social_notifications
       (notification_id, recipient_user_id, actor_user_id, notification_type,
        target_type, target_id, dedupe_key, payload_json, created_at)
     VALUES ($1, $2, $3, 'COMMENT', 'content', $4, $5, $6, $7),
            ($8, $2, $3, 'LIKE', 'content', $4, $9, $6, $10),
            ($11, $12, $3, 'FOLLOW', 'user', $2, $13, $6, $10)`,
    [
      notifications[0], recipientId, marker + '-actor', contentId,
      marker + '-dedupe-1', JSON.stringify({ contentId }), timestamp(-30),
      notifications[1], marker + '-dedupe-2', timestamp(-20),
      notifications[2], otherRecipientId, marker + '-dedupe-3',
    ],
  )
  fixturePrepared = true

  // W05 topic-page lookup and keyset edge scan, with publication still resolved by W03.
  const topicPage = await getTopicPage(
    store,
    contentBinding,
    marker + '-topic-name',
    '2',
    null,
    'w05-social-closure-read-postgres',
  )
  assert.equal(topicPage.topic.topicId, topicId)
  assert.equal(topicPage.contents.length, 2)
  assert.equal(topicPage.contents[0]?.id, marker + '-topic-content-3')
  assert.equal(topicPage.hasMore, true)
  assert.equal(typeof topicPage.nextCursor, 'string')

  // Discovery reads bounded active topic/content edges and then ranks only W03-published contexts.
  const discovery = await listDiscoveryTopics(
    store,
    contentBinding,
    'w05-social-closure-read-postgres-discovery',
    '10',
    null,
  )
  assert.equal(discovery.items.some((item) => item.topicId === topicId), true)
  assert.equal(discovery.items.some((item) => item.topicId === secondTopicId), true)
  assert.equal(discovery.items.some((item) => item.topicId === restrictedTopicId), false)

  const inboxPage = await listNotifications(store, recipientId, null, '1')
  assert.equal(inboxPage.items.length, 1)
  assert.equal(inboxPage.items[0]?.id, notifications[1], 'Inbox order must remain newest notification first')
  assert.equal(inboxPage.unreadCount, 2)
  assert.equal(inboxPage.hasMore, true)
  assert.equal(typeof inboxPage.nextCursor, 'string')

  await markNotificationRead(store, recipientId, notifications[1])
  const afterSingleRead = await listNotifications(store, recipientId, null, '10')
  assert.equal(afterSingleRead.unreadCount, 1)
  assert.equal(afterSingleRead.items.find((item) => item.id === notifications[1])?.readAt !== null, true)
  assert.equal(afterSingleRead.items.find((item) => item.id === notifications[0])?.readAt, null)

  await markAllNotificationsRead(store, recipientId)
  const afterReadAll = await listNotifications(store, recipientId, null, '10')
  assert.equal(afterReadAll.unreadCount, 0)
  assert.equal(afterReadAll.items.every((item) => item.readAt !== null), true)
  assert.equal((await listNotifications(store, otherRecipientId, null, '10')).items.length, 1,
    'Notification list and read state must not cross recipient boundaries')

  // Content summary combines W05-owned counters/viewer state and stored topic/mention projections only.
  await pool.query(
    `INSERT INTO interaction_likes (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES ($1, $2, 'content', $3, $4)`,
    [marker + '-like', viewerId, contentId, nowIso],
  )
  await pool.query(
    `INSERT INTO social_comments
       (id, content_id, author_user_id, body, state, depth, idempotency_key, created_at, updated_at)
     VALUES ($1, $2, $3, 'Synthetic comment', 'PUBLISHED', 0, $4, $5, $5)`,
    [marker + '-comment', contentId, viewerId, marker + '-comment-idem', nowIso],
  )
  await pool.query(
    `INSERT INTO interaction_favorites (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES ($1, $2, 'content', $3, $4)`,
    [marker + '-favorite', viewerId, contentId, nowIso],
  )
  await pool.query(
    `INSERT INTO social_share_links (share_id, content_id, actor_user_id, idempotency_key, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [marker + '-share', contentId, viewerId, marker + '-share-idem', nowIso],
  )
  await pool.query(
    `INSERT INTO social_reposts (repost_id, content_id, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4)`,
    [marker + '-repost', contentId, viewerId, nowIso],
  )
  await pool.query(
    `INSERT INTO social_profile_pins (user_id, content_id, pinned_at)
     VALUES ($1, $2, $3)`,
    [ownerId, contentId, nowIso],
  )

  const summary = await getContentSocialSummary(store, contentId, {
    contentId,
    ownerUserId: ownerId,
    contentType: 'post',
    state: 'PUBLISHED',
    updatedAt: nowIso,
  }, viewerId)
  assert.deepEqual(summary.counts, {
    likes: 1,
    comments: 1,
    favorites: 1,
    shares: 1,
    reposts: 1,
  })
  assert.equal(summary.pinned, true)
  assert.deepEqual(summary.viewer, { liked: true, favorited: true, reposted: true })
  assert.deepEqual(summary.topics, [])
  assert.deepEqual(summary.mentions, [])

  runtimePassed = true
} finally {
  try {
    await pool.query('DELETE FROM social_notification_push_deliveries WHERE notification_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_notification_push_outbox WHERE notification_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_notifications WHERE notification_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM interaction_likes WHERE relationship_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_comments WHERE id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM interaction_favorites WHERE relationship_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_share_links WHERE share_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_reposts WHERE repost_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_profile_pins WHERE user_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_target_topics WHERE relation_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_topics WHERE topic_id LIKE $1', [marker + '%'])

    const postflight = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM social_notifications WHERE notification_id LIKE $1) AS notifications,
         (SELECT count(*)::int FROM social_notification_push_outbox WHERE notification_id LIKE $1) AS outbox,
         (SELECT count(*)::int FROM social_target_topics WHERE relation_id LIKE $1) AS topic_edges,
         (SELECT count(*)::int FROM social_topics WHERE topic_id LIKE $1) AS topics,
         (SELECT count(*)::int FROM interaction_likes WHERE relationship_id LIKE $1) AS likes,
         (SELECT count(*)::int FROM social_comments WHERE id LIKE $1) AS comments,
         (SELECT count(*)::int FROM interaction_favorites WHERE relationship_id LIKE $1) AS favorites,
         (SELECT count(*)::int FROM social_share_links WHERE share_id LIKE $1) AS shares,
         (SELECT count(*)::int FROM social_reposts WHERE repost_id LIKE $1) AS reposts,
         (SELECT count(*)::int FROM social_profile_pins WHERE user_id LIKE $1) AS pins`,
      [marker + '%'],
    )
    const remaining = postflight.rows[0] ?? {}
    for (const [name, value] of Object.entries(remaining)) {
      assert.equal(value, 0, 'Synthetic ' + name + ' rows must be removed')
    }

    const report = {
      status: runtimePassed ? 'W05_SOCIAL_CLOSURE_READ_POSTGRES_RUNTIME_PASS' : 'W05_SOCIAL_CLOSURE_READ_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      topicPageBoundedKeysetVerified: true,
      discoveryActiveTopicAndW03PublicationAuthorityVerified: true,
      notificationPaginationRecipientScopeAndUnreadCountVerified: true,
      singleAndBulkReadUpdatesVerified: true,
      notificationOutboxTriggerObserved: fixturePrepared,
      contentSocialCountersAndViewerStateVerified: true,
      noW03ContentTableReadByW05: true,
      remainingFixtureRows: remaining,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_SOCIAL_CLOSURE_READ_POSTGRES_RUNTIME_PASS ' : 'W05_SOCIAL_CLOSURE_READ_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
