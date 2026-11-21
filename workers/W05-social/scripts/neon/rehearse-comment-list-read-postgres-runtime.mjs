import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { listComments, CommentRuntimeError } from '../../src/comment-runtime.ts'
import { createPostgresCommentListReadStore } from '../../src/comment-list-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_COMMENT_LIST_READ_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_COMMENT_LIST_READ_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_COMMENT_LIST_READ_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-comment-list-read-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const store = createPostgresCommentListReadStore(client)
const marker = 'w05-comment-list-read-' + randomUUID()
const contentId = marker + '-content'
const viewer = marker + '-viewer'
const rootA = marker + '-root-a'
const rootB = marker + '-root-b'
const blockedRoot = marker + '-blocked-root'
const replyA = marker + '-reply-a'
const mutedReply = marker + '-muted-reply'
const pending = marker + '-pending'
const authorA = marker + '-author-a'
const authorB = marker + '-author-b'
const blockedAuthor = marker + '-blocked-author'
const replyAuthor = marker + '-reply-author'
const mutedAuthor = marker + '-muted-author'
const now = new Date().toISOString()
const baseTime = '2026-11-11T10:00:00'
const rootATime = baseTime + '.000001Z'
const replyATime = baseTime + '.000002Z'
const rootBTime = baseTime + '.000003Z'
const blockedTime = baseTime + '.000004Z'
const pendingTime = baseTime + '.000005Z'

let relevantThreadOrder = false
let keysetCursorPreservesMicroseconds = false
let recentThreadOrder = false
let likedThreadOrder = false
let viewerLikeAndMentions = false
let blockAndMuteFiltering = false
let hiddenPendingComment = false
let publishedContextFailsClosed = false
let cleanupPassed = false
let reads = 0

const context = {
  contentId,
  ownerUserId: marker + '-owner',
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: now,
}
const instrumentedStore = {
  async list(input) {
    reads += 1
    return store.list(input)
  },
}
const unusedD1 = {
  prepare() { throw new Error('Unexpected D1 access during PostgreSQL comment-list rehearsal') },
}

const insertComment = async (id, authorUserId, parentId, body, depth, state, idempotencyKey, createdAt) => {
  await client.query(
    `INSERT INTO social_comments
      (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz)`,
    [id, contentId, authorUserId, parentId, body, state, depth, idempotencyKey, createdAt],
  )
}

try {
  const version = await client.query("SELECT current_setting('server_version_num')::integer / 10000 AS major")
  assert.equal(Number(version.rows[0]?.major), 18, 'runtime rehearsal must use PostgreSQL 18')

  await insertComment(rootA, authorA, null, 'root A', 0, 'PUBLISHED', marker + '-key-root-a', rootATime)
  await insertComment(replyA, replyAuthor, rootA, 'visible reply A', 1, 'PUBLISHED', marker + '-key-reply-a', replyATime)
  await insertComment(mutedReply, mutedAuthor, rootA, 'muted reply', 1, 'PUBLISHED', marker + '-key-muted-reply', baseTime + '.0000025Z')
  await insertComment(rootB, authorB, null, 'root B', 0, 'PUBLISHED', marker + '-key-root-b', rootBTime)
  await insertComment(blockedRoot, blockedAuthor, null, 'blocked root', 0, 'PUBLISHED', marker + '-key-blocked', blockedTime)
  await insertComment(pending, marker + '-pending-author', null, 'pending root', 0, 'PENDING', marker + '-key-pending', pendingTime)

  await client.query(
    `INSERT INTO interaction_likes (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES ($1, $2, 'comment', $3, $4::timestamptz),
            ($5, $6, 'comment', $3, $4::timestamptz),
            ($7, $8, 'comment', $9, $4::timestamptz)`,
    [
      marker + '-like-root-a-1', marker + '-liker-a', rootA, now,
      marker + '-like-root-a-2', marker + '-liker-b',
      marker + '-like-reply-a', viewer, replyA,
    ],
  )
  await client.query(
    `INSERT INTO interaction_likes (relationship_id, actor_user_id, target_type, target_id, created_at)
     VALUES ($1, $2, 'comment', $3, $4::timestamptz)`,
    [marker + '-like-root-b', marker + '-liker-c', rootB, now],
  )
  await client.query(
    `INSERT INTO social_mentions
      (mention_id, target_type, target_id, actor_user_id, mentioned_user_id, handle, created_at)
     VALUES ($1, 'comment', $2, $3, $4, $5, $6::timestamptz)`,
    [marker + '-mention', rootA, authorA, marker + '-mentioned-user', 'alice', now],
  )
  await client.query(
    `INSERT INTO social_user_interactions
      (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES ($1, $2, $3, 'block', $4::timestamptz, $4::timestamptz),
            ($5, $2, $6, 'mute', $4::timestamptz, $4::timestamptz)`,
    [marker + '-block', viewer, blockedAuthor, now, marker + '-mute', mutedAuthor],
  )

  const allRecent = await listComments(instrumentedStore, contentId, null, 20, context, viewer, 'recent')
  assert.deepEqual(allRecent.items.map(item => item.id), [rootB, rootA, replyA])
  recentThreadOrder = true
  assert.equal(allRecent.items.find(item => item.id === rootA)?.mentions[0]?.handle, 'alice')
  assert.equal(allRecent.items.find(item => item.id === replyA)?.likedByViewer, true)
  viewerLikeAndMentions = true
  assert(!allRecent.items.some(item => item.id === blockedRoot || item.id === mutedReply))
  blockAndMuteFiltering = true
  assert(!allRecent.items.some(item => item.id === pending))
  hiddenPendingComment = true

  const relevantFirst = await listComments(instrumentedStore, contentId, null, 1, context, viewer, 'relevant')
  assert.equal(relevantFirst.items[0]?.id, rootA)
  assert.equal(relevantFirst.hasMore, true)
  assert.ok(relevantFirst.nextCursor)
  const padded = relevantFirst.nextCursor.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - relevantFirst.nextCursor.length % 4) % 4)
  const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  assert.equal(decoded.createdAt, rootATime)
  assert.equal(decoded.createdAt.includes('.000001Z'), true)
  keysetCursorPreservesMicroseconds = true

  const relevantSecond = await listComments(instrumentedStore, contentId, relevantFirst.nextCursor, 1, context, viewer, 'relevant')
  assert.equal(relevantSecond.items[0]?.id, replyA)
  assert.notEqual(relevantSecond.items[0]?.id, relevantFirst.items[0]?.id)
  relevantThreadOrder = true

  const allLiked = await listComments(instrumentedStore, contentId, null, 20, context, viewer, 'liked')
  assert.deepEqual(allLiked.items.map(item => item.id), [rootA, replyA, rootB])
  likedThreadOrder = true

  const beforeRejectedContext = reads
  await assert.rejects(
    listComments(instrumentedStore, contentId, null, 20, { ...context, state: 'DRAFT' }, viewer, 'recent'),
    error => error instanceof CommentRuntimeError && error.code === 'NOT_FOUND' && error.status === 404,
  )
  assert.equal(reads, beforeRejectedContext)
  publishedContextFailsClosed = true
} finally {
  try {
    await client.query('DELETE FROM social_mentions WHERE mention_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM interaction_likes WHERE relationship_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_user_interactions WHERE relationship_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_comments WHERE id LIKE $1', [marker + '-%'])
    const residue = await client.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM social_comments WHERE id LIKE $1) AS comments,
         (SELECT COUNT(*)::integer FROM interaction_likes WHERE relationship_id LIKE $1) AS likes,
         (SELECT COUNT(*)::integer FROM social_mentions WHERE mention_id LIKE $1) AS mentions,
         (SELECT COUNT(*)::integer FROM social_user_interactions WHERE relationship_id LIKE $1) AS interactions`,
      [marker + '-%'],
    )
    assert.deepEqual(residue.rows[0], { comments: 0, likes: 0, mentions: 0, interactions: 0 })
    cleanupPassed = true
  } finally {
    client.release()
    await pool.end()
  }
}

const checks = {
  recentThreadOrdering: recentThreadOrder,
  relevantThreadOrdering: relevantThreadOrder,
  likedThreadOrdering: likedThreadOrder,
  microsecondKeysetCursor: keysetCursorPreservesMicroseconds,
  viewerLikeAndMentionProjection: viewerLikeAndMentions,
  bilateralBlockAndUnilateralMuteFilters: blockAndMuteFiltering,
  pendingCommentsHidden: hiddenPendingComment,
  unpublishedContextFailsClosed: publishedContextFailsClosed,
  syntheticRowsRemoved: cleanupPassed,
}
if (Object.values(checks).some(value => value !== true)) {
  throw new Error('W05 PostgreSQL comment-list rehearsal did not complete every assertion: ' + JSON.stringify(checks))
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor: 18,
  checks,
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 PostgreSQL 18 comment-list read rehearsal passed; synthetic rows removed')
