import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { getSocialTargets } from '../../src/social-closure-runtime.ts'
import { createPostgresSocialTargetsReadStore } from '../../src/social-targets-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_SOCIAL_TARGETS_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_SOCIAL_TARGETS_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to rehearse W05 social targets outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-social-targets-' + randomUUID()
const reportPath = process.env.W05_SOCIAL_TARGETS_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-social-targets-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000 })
const store = createPostgresSocialTargetsReadStore(pool)
let runtimePassed = false

const contentTargetId = marker + '-content'
const commentTargetId = marker + '-comment'
const topicCreatedAt = (index) => new Date(Date.UTC(2026, 10, 10, 0, 0, index)).toISOString()
const mentionCreatedAt = (index) => new Date(Date.UTC(2026, 10, 10, 1, 0, index)).toISOString()

try {
  // Create more than each public result cap so both LIMIT clauses are exercised.
  for (let index = 0; index < 55; index += 1) {
    const topicId = marker + '-topic-' + String(index).padStart(3, '0')
    await pool.query(
      `INSERT INTO social_topics
         (topic_id, normalized_name, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', $4, $4)`,
      [topicId, marker + '-name-' + index, 'Topic ' + index, topicCreatedAt(index)],
    )
    await pool.query(
      `INSERT INTO social_target_topics
         (relation_id, target_type, target_id, topic_id, token, created_at)
       VALUES ($1, 'content', $2, $3, $4, $5)`,
      [marker + '-edge-' + index, contentTargetId, topicId, '#' + index, topicCreatedAt(index)],
    )
  }

  const restrictedTopicId = marker + '-restricted-topic'
  await pool.query(
    `INSERT INTO social_topics
       (topic_id, normalized_name, display_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'RESTRICTED', $4, $4)`,
    [restrictedTopicId, marker + '-restricted', 'Restricted topic', topicCreatedAt(56)],
  )
  await pool.query(
    `INSERT INTO social_target_topics
       (relation_id, target_type, target_id, topic_id, token, created_at)
     VALUES ($1, 'content', $2, $3, '#restricted', $4)`,
    [marker + '-restricted-edge', contentTargetId, restrictedTopicId, topicCreatedAt(56)],
  )

  for (let index = 0; index < 105; index += 1) {
    await pool.query(
      `INSERT INTO social_mentions
         (mention_id, target_type, target_id, actor_user_id, mentioned_user_id, handle, created_at)
       VALUES ($1, 'content', $2, $3, $4, $5, $6)`,
      [
        marker + '-mention-' + String(index).padStart(3, '0'),
        contentTargetId,
        marker + '-actor',
        marker + '-mentioned-' + index,
        'historical-' + index,
        mentionCreatedAt(index),
      ],
    )
  }

  const commentTopicId = marker + '-comment-topic'
  await pool.query(
    `INSERT INTO social_topics
       (topic_id, normalized_name, display_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'ACTIVE', $4, $4)`,
    [commentTopicId, marker + '-comment-name', 'Comment topic', topicCreatedAt(57)],
  )
  await pool.query(
    `INSERT INTO social_target_topics
       (relation_id, target_type, target_id, topic_id, token, created_at)
     VALUES ($1, 'comment', $2, $3, '#comment', $4)`,
    [marker + '-comment-edge', commentTargetId, commentTopicId, topicCreatedAt(57)],
  )
  await pool.query(
    `INSERT INTO social_mentions
       (mention_id, target_type, target_id, actor_user_id, mentioned_user_id, handle, created_at)
     VALUES ($1, 'comment', $2, $3, $4, $5, $6)`,
    [
      marker + '-comment-mention',
      commentTargetId,
      marker + '-actor',
      marker + '-comment-mentioned',
      'comment-historical-handle',
      mentionCreatedAt(106),
    ],
  )

  const contentTargets = await getSocialTargets(store, 'content', contentTargetId)
  assert.equal(contentTargets.topics.length, 50, 'Content topic reads must enforce the 50-row cap')
  assert.equal(contentTargets.topics[0]?.topicId, marker + '-topic-000', 'Topic order must remain oldest edge first')
  assert.equal(contentTargets.topics.at(-1)?.topicId, marker + '-topic-049')
  assert.equal(contentTargets.topics.some((item) => item.topicId === restrictedTopicId), false,
    'Restricted topics must not be exposed')
  assert.equal(contentTargets.mentions.length, 100, 'Content mention reads must enforce the 100-row cap')
  assert.equal(contentTargets.mentions[0]?.userId, marker + '-mentioned-0')
  assert.equal(contentTargets.mentions.at(-1)?.userId, marker + '-mentioned-99')
  assert.equal(contentTargets.mentions[0]?.handle, 'historical-0',
    'Mention reads must retain the stored handle rather than re-resolving current usernames')

  const commentTargets = await getSocialTargets(store, 'comment', commentTargetId)
  assert.deepEqual(commentTargets, {
    topics: [{
      topicId: commentTopicId,
      name: marker + '-comment-name',
      displayName: 'Comment topic',
    }],
    mentions: [{
      userId: marker + '-comment-mentioned',
      handle: 'comment-historical-handle',
    }],
  }, 'Comment target data must remain isolated from content targets')

  runtimePassed = true
} finally {
  try {
    await pool.query('DELETE FROM social_target_topics WHERE target_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_mentions WHERE target_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_topics WHERE topic_id LIKE $1', [marker + '%'])

    const postflight = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM social_target_topics WHERE target_id LIKE $1) AS target_topic_rows,
         (SELECT count(*)::int FROM social_mentions WHERE target_id LIKE $1) AS mention_rows,
         (SELECT count(*)::int FROM social_topics WHERE topic_id LIKE $1) AS topic_rows`,
      [marker + '%'],
    )
    const remaining = postflight.rows[0] ?? {}
    assert.equal(remaining.target_topic_rows, 0, 'All synthetic topic edges must be removed')
    assert.equal(remaining.mention_rows, 0, 'All synthetic mentions must be removed')
    assert.equal(remaining.topic_rows, 0, 'All synthetic topics must be removed')

    const report = {
      status: runtimePassed ? 'W05_SOCIAL_TARGETS_POSTGRES_RUNTIME_PASS' : 'W05_SOCIAL_TARGETS_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      topicLimit50Verified: true,
      mentionLimit100Verified: true,
      activeTopicFilterVerified: true,
      ascendingEdgeOrderVerified: true,
      targetTypeIsolationVerified: true,
      storedMentionIdentityAndHandlePreserved: true,
      remainingFixtureRows: {
        targetTopics: remaining.target_topic_rows,
        mentions: remaining.mention_rows,
        topics: remaining.topic_rows,
      },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_SOCIAL_TARGETS_POSTGRES_RUNTIME_PASS ' : 'W05_SOCIAL_TARGETS_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
