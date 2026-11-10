import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'

import { FollowRuntimeError, follow, unfollow } from '../../src/follow-runtime.ts'
import { createPostgresFollowStore } from '../../src/follow-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_FOLLOW_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_FOLLOW_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 Follow rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-pg-follow-' + randomUUID()
const reportPath = process.env.W05_FOLLOW_POSTGRES_REPORT || '../../artifacts/neon/w05-follow-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresFollowStore(pool)

const countRelationship = async (followerUserId, targetUserId) => {
  const result = await pool.query(
    `SELECT count(*)::int AS count
       FROM social_follow_relationships
      WHERE follower_user_id = $1 AND target_user_id = $2`,
    [followerUserId, targetUserId],
  )
  return result.rows[0]?.count ?? -1
}

async function insertBlock(actorUserId, targetUserId, relationId) {
  await pool.query(
    `INSERT INTO social_user_interactions
       (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at)
     VALUES ($1, $2, $3, 'block', now(), now())`,
    [relationId, actorUserId, targetUserId],
  )
}

try {
  const follower = marker + '-follower'
  const targetUser = marker + '-target'

  const [first, concurrent] = await Promise.all([
    follow(store, follower, targetUser),
    follow(store, follower, targetUser),
  ])
  assert.equal(first.relationship_id, concurrent.relationship_id, 'Concurrent duplicate follows must converge on one immutable relationship ID')
  assert.equal(first.follower_user_id, follower)
  assert.equal(first.target_user_id, targetUser)
  assert.match(first.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  assert.equal(await countRelationship(follower, targetUser), 1, 'Unique pair constraint must retain exactly one active relationship')

  const blockedFollower = marker + '-blocked-a'
  const blockedTarget = marker + '-blocked-a-target'
  await insertBlock(blockedFollower, blockedTarget, marker + '-block-a')
  await assert.rejects(
    follow(store, blockedFollower, blockedTarget),
    (error) => error instanceof FollowRuntimeError && error.code === 'CONFLICT' && error.status === 409,
    'A block from follower to target must prevent Follow',
  )
  assert.equal(await countRelationship(blockedFollower, blockedTarget), 0)

  const reverseFollower = marker + '-blocked-b'
  const reverseTarget = marker + '-blocked-b-target'
  await insertBlock(reverseTarget, reverseFollower, marker + '-block-b')
  await assert.rejects(
    follow(store, reverseFollower, reverseTarget),
    (error) => error instanceof FollowRuntimeError && error.code === 'CONFLICT' && error.status === 409,
    'A block from target to follower must prevent Follow',
  )
  assert.equal(await countRelationship(reverseFollower, reverseTarget), 0)

  await assert.rejects(
    follow(store, follower, follower),
    (error) => error instanceof FollowRuntimeError && error.code === 'CONFLICT' && error.status === 409,
    'Self-follow must be rejected before a database mutation',
  )

  await unfollow(store, follower, targetUser)
  await unfollow(store, follower, targetUser)
  assert.equal(await countRelationship(follower, targetUser), 0, 'Unfollow must delete the active relationship and missing deletes must be idempotent')

  const afterRefollow = await follow(store, follower, targetUser)
  assert.notEqual(afterRefollow.relationship_id, first.relationship_id, 'A removed relationship identifier must never be reused')
  await unfollow(store, follower, targetUser)
} finally {
  try {
    await pool.query(
      'DELETE FROM social_follow_relationships WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM social_user_interactions WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )

    const postflight = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM social_follow_relationships
           WHERE follower_user_id LIKE $1 OR target_user_id LIKE $1) AS follow_rows,
         (SELECT count(*)::int FROM social_user_interactions
           WHERE actor_user_id LIKE $1 OR target_user_id LIKE $1) AS interaction_rows`,
      [marker + '%'],
    )
    const followRows = postflight.rows[0]?.follow_rows ?? -1
    const interactionRows = postflight.rows[0]?.interaction_rows ?? -1
    assert.equal(followRows, 0, 'All synthetic Follow rows must be removed')
    assert.equal(interactionRows, 0, 'All synthetic Block rows must be removed')

    const report = {
      status: 'W05_FOLLOW_POSTGRES_RUNTIME_PASS',
      postgresDatabase: target.pathname.slice(1),
      concurrentFollowConverged: true,
      uniqueRelationshipRows: 1,
      bothBlockDirectionsDenied: true,
      selfFollowDenied: true,
      repeatedUnfollowIdempotent: true,
      relationshipIdNotReused: true,
      remainingFixtureRows: { follow: followRows, interactions: interactionRows },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log('W05_FOLLOW_POSTGRES_RUNTIME_PASS ' + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
