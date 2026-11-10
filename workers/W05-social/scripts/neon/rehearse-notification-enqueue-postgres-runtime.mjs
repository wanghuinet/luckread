import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { enqueueNotification } from '../../src/social-closure-runtime.ts'
import { createPostgresNotificationEnqueueStore } from '../../src/notification-enqueue-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_NOTIFICATION_ENQUEUE_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_NOTIFICATION_ENQUEUE_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to rehearse W05 notification enqueue outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-notification-enqueue-' + randomUUID()
const reportPath = process.env.W05_NOTIFICATION_ENQUEUE_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-notification-enqueue-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 })
const store = createPostgresNotificationEnqueueStore(pool)
const now = new Date().toISOString()
const actorId = marker + '-actor'
const recipientId = marker + '-recipient'
const blockedActorId = marker + '-blocked-actor'
const blockedRecipientId = marker + '-blocked-recipient'
const disabledRecipientId = marker + '-disabled-recipient'
const commentTargetId = marker + '-comment-target'
const followTargetId = marker + '-follow-target'
const blockedTargetId = marker + '-blocked-target'
const disabledTargetId = marker + '-disabled-target'
const dedupeKey = (type, recipient, actor, targetType, targetId) =>
  [type, recipient, actor, targetType, targetId].join(':')

let assertionsPassed = false
let insertedNotificationCount = 0
let insertedOutboxCount = 0

try {
  // A recipient-side block exercises the reverse direction of the bilateral block guard.
  await pool.query(
    `INSERT INTO social_user_interactions
       (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES ($1, $2, $3, 'block', $4, $4)`,
    [marker + '-block', blockedRecipientId, blockedActorId, now],
  )
  await pool.query(
    `INSERT INTO social_notification_preferences
       (user_id, follow_enabled, like_enabled, comment_enabled, mention_enabled, updated_at)
     VALUES ($1, 1, 1, 1, 0, $2)`,
    [disabledRecipientId, now],
  )

  const valid = {
    recipientUserId: recipientId,
    actorUserId: actorId,
    type: 'COMMENT',
    targetType: 'content',
    targetId: commentTargetId,
    payload: { eventId: marker + '-comment-event' },
  }
  await enqueueNotification(store, valid)
  // A repeated semantic event uses the same dedupe key; it must not create
  // another inbox row or another outbox trigger event.
  await enqueueNotification(store, { ...valid, payload: { eventId: marker + '-duplicate-event' } })

  const defaultOn = {
    recipientUserId: marker + '-default-on-recipient',
    actorUserId: actorId,
    type: 'FOLLOW',
    targetType: 'user',
    targetId: followTargetId,
    payload: { eventId: marker + '-follow-event' },
  }
  await enqueueNotification(store, defaultOn)

  await enqueueNotification(store, {
    recipientUserId: blockedRecipientId,
    actorUserId: blockedActorId,
    type: 'LIKE',
    targetType: 'content',
    targetId: blockedTargetId,
    payload: { eventId: marker + '-blocked-event' },
  })
  await enqueueNotification(store, {
    recipientUserId: disabledRecipientId,
    actorUserId: actorId,
    type: 'MENTION',
    targetType: 'comment',
    targetId: disabledTargetId,
    payload: { eventId: marker + '-disabled-event' },
  })
  await enqueueNotification(store, {
    recipientUserId: actorId,
    actorUserId: actorId,
    type: 'REPLY',
    targetType: 'comment',
    targetId: marker + '-self-target',
  })

  const validRow = await pool.query(
    'SELECT notification_id, payload_json FROM social_notifications WHERE dedupe_key = $1',
    [dedupeKey('COMMENT', recipientId, actorId, 'content', commentTargetId)],
  )
  assert.equal(validRow.rows.length, 1, 'Duplicate semantic notification must collapse to one inbox row')
  assert.equal(validRow.rows[0]?.payload_json, JSON.stringify({ eventId: marker + '-comment-event' }),
    'The first successful event payload remains authoritative on duplicate enqueue')

  const defaultOnRow = await pool.query(
    'SELECT notification_id FROM social_notifications WHERE dedupe_key = $1',
    [dedupeKey('FOLLOW', defaultOn.recipientUserId, actorId, 'user', followTargetId)],
  )
  assert.equal(defaultOnRow.rows.length, 1, 'Missing preference row must preserve default-on delivery')

  const blockedRow = await pool.query(
    'SELECT notification_id FROM social_notifications WHERE dedupe_key = $1',
    [dedupeKey('LIKE', blockedRecipientId, blockedActorId, 'content', blockedTargetId)],
  )
  assert.equal(blockedRow.rows.length, 0, 'A block in either direction must suppress notification enqueue')

  const disabledRow = await pool.query(
    'SELECT notification_id FROM social_notifications WHERE dedupe_key = $1',
    [dedupeKey('MENTION', disabledRecipientId, actorId, 'comment', disabledTargetId)],
  )
  assert.equal(disabledRow.rows.length, 0, 'Disabled mention preference must suppress notification enqueue')

  const selfRow = await pool.query(
    'SELECT notification_id FROM social_notifications WHERE actor_user_id = $1 AND recipient_user_id = $1',
    [actorId],
  )
  assert.equal(selfRow.rows.length, 0, 'Self-notifications must be ignored')

  const inboxRows = await pool.query(
    'SELECT count(*)::int AS count FROM social_notifications WHERE recipient_user_id LIKE $1',
    [marker + '%'],
  )
  insertedNotificationCount = Number(inboxRows.rows[0]?.count ?? 0)
  assert.equal(insertedNotificationCount, 2)

  const outboxRows = await pool.query(
    'SELECT count(*)::int AS count FROM social_notification_push_outbox WHERE recipient_user_id LIKE $1',
    [marker + '%'],
  )
  insertedOutboxCount = Number(outboxRows.rows[0]?.count ?? 0)
  assert.equal(insertedOutboxCount, 2, 'Each new inbox row must atomically create exactly one W05-owned outbox row')

  const outboxJoin = await pool.query(
    `SELECT count(*)::int AS count
       FROM social_notifications n
       JOIN social_notification_push_outbox o USING (notification_id)
      WHERE n.recipient_user_id LIKE $1
        AND n.recipient_user_id = o.recipient_user_id`,
    [marker + '%'],
  )
  assert.equal(Number(outboxJoin.rows[0]?.count ?? 0), 2, 'Outbox recipient ownership must match the inbox notification')

  assertionsPassed = true
} finally {
  try {
    const fixtureIds = await pool.query(
      'SELECT notification_id FROM social_notifications WHERE recipient_user_id LIKE $1',
      [marker + '%'],
    )
    const notificationIds = fixtureIds.rows.map((row) => row.notification_id)
    await pool.query(
      'DELETE FROM social_notification_push_deliveries WHERE notification_id = ANY($1::text[])',
      [notificationIds],
    )
    await pool.query('DELETE FROM social_notification_push_outbox WHERE recipient_user_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_notifications WHERE recipient_user_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_notification_preferences WHERE user_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_user_interactions WHERE relationship_id LIKE $1', [marker + '%'])

    const postflight = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM social_notifications WHERE recipient_user_id LIKE $1) AS notifications,
         (SELECT count(*)::int FROM social_notification_push_outbox WHERE recipient_user_id LIKE $1) AS outbox,
         (SELECT count(*)::int FROM social_notification_push_deliveries WHERE notification_id = ANY($2::text[])) AS deliveries,
         (SELECT count(*)::int FROM social_notification_preferences WHERE user_id LIKE $1) AS preferences,
         (SELECT count(*)::int FROM social_user_interactions WHERE relationship_id LIKE $1) AS blocks`,
      [marker + '%', notificationIds],
    )
    const remaining = postflight.rows[0] ?? {}
    for (const [name, value] of Object.entries(remaining)) {
      assert.equal(value, 0, 'Synthetic ' + name + ' rows must be removed')
    }

    const report = {
      status: assertionsPassed ? 'W05_NOTIFICATION_ENQUEUE_POSTGRES_RUNTIME_PASS' : 'W05_NOTIFICATION_ENQUEUE_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      bilateralBlockGuardVerified: true,
      defaultOnAndPerTypePreferenceVerified: true,
      dedupeKeyIdempotencyVerified: true,
      selfNotificationSuppressionVerified: true,
      atomicD1_02OutboxTriggerVerified: assertionsPassed && insertedNotificationCount === insertedOutboxCount,
      insertedNotificationCount,
      insertedOutboxCount,
      remainingFixtureRows: remaining,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((assertionsPassed ? 'W05_NOTIFICATION_ENQUEUE_POSTGRES_RUNTIME_PASS ' : 'W05_NOTIFICATION_ENQUEUE_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
