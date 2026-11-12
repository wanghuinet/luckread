import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { getLikeStatus } from '../../src/like-runtime.ts'
import { createPostgresLikeStatusReadStore } from '../../src/like-status-read-store-postgres.ts'
import { createPostgresLikeTargetContextReadStore } from '../../src/like-target-context-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_LIKE_STATUS_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_LIKE_STATUS_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const marker = 'w05-like-status-' + randomUUID()
const reportPath = process.env.W05_LIKE_STATUS_POSTGRES_REPORT || '../../artifacts/neon/w05-like-status-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresLikeStatusReadStore(pool)
const targetContextStore = createPostgresLikeTargetContextReadStore(pool)
const noD1Database = Object.freeze({})
let contentReadPassed = false
let actorScopePassed = false
let commentReadPassed = false
const actor = marker + '-actor'
const otherActor = marker + '-other'
const contentId = marker + '-content'
const commentId = marker + '-comment'

const publishedBinding = {
  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init)
    const resolvedContentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json({
      data: {
        contentId: resolvedContentId,
        ownerUserId: marker + '-content-owner',
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    })
  },
}

try {
  await pool.query(
    'INSERT INTO interaction_likes (relationship_id, actor_user_id, target_type, target_id, created_at) VALUES ($1,$2,$3,$4,now()),($5,$6,$7,$8,now()),($9,$10,$11,$12,now())',
    [
      marker + '-content-like-1', actor, 'content', contentId,
      marker + '-content-like-2', otherActor, 'content', contentId,
      marker + '-comment-like-1', actor, 'comment', commentId,
    ],
  )
  await pool.query(
    'INSERT INTO social_comments (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at) VALUES ($1,$2,$3,NULL,$4,$5,0,$6,now(),now())',
    [commentId, contentId, marker + '-comment-author', 'synthetic rehearsal comment', 'PUBLISHED', marker + '-idempotency'],
  )

  const contentStatus = await getLikeStatus(
    noD1Database,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: contentId },
    marker + '-content-correlation',
    undefined,
    store,
    targetContextStore,
  )
  assert.deepEqual(contentStatus, { liked: true, likeCount: 2 })
  contentReadPassed = true

  const otherActorContentStatus = await getLikeStatus(
    noD1Database,
    publishedBinding,
    marker + '-third-actor',
    { targetType: 'content', targetId: contentId },
    marker + '-actor-scope-correlation',
    undefined,
    store,
    targetContextStore,
  )
  assert.deepEqual(otherActorContentStatus, { liked: false, likeCount: 2 })
  actorScopePassed = true

  const commentStatus = await getLikeStatus(
    noD1Database,
    publishedBinding,
    actor,
    { targetType: 'comment', targetId: commentId },
    marker + '-comment-correlation',
    undefined,
    store,
    targetContextStore,
  )
  assert.deepEqual(commentStatus, { liked: true, likeCount: 1 })
  commentReadPassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM interaction_likes WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1',
      [marker + '%'],
    )
    await pool.query('DELETE FROM social_comments WHERE id LIKE $1', [marker + '%'])
    const likes = await pool.query(
      'SELECT count(*)::int AS rows FROM interaction_likes WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1',
      [marker + '%'],
    )
    const comments = await pool.query(
      'SELECT count(*)::int AS rows FROM social_comments WHERE id LIKE $1',
      [marker + '%'],
    )
    const remaining = (likes.rows[0]?.rows ?? -1) + (comments.rows[0]?.rows ?? -1)
    assert.equal(remaining, 0, 'All synthetic like and comment rows must be removed')
    const passed = contentReadPassed && actorScopePassed && commentReadPassed
    const report = {
      status: passed ? 'W05_LIKE_STATUS_POSTGRES_RUNTIME_PASS' : 'W05_LIKE_STATUS_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      contentLikeStateAndAggregate: contentReadPassed,
      actorScopedLikeState: actorScopePassed,
      commentLikeStateAndAggregate: commentReadPassed,
      fixtureCleanupVerified: true,
      remainingFixtureRows: remaining,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((passed ? 'W05_LIKE_STATUS_POSTGRES_RUNTIME_PASS ' : 'W05_LIKE_STATUS_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
    if (!passed) process.exitCode = 1
  } finally {
    await pool.end()
  }
}
