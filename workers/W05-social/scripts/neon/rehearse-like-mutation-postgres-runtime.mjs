import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { like, unlike, LikeRuntimeError } from '../../src/like-runtime.ts'
import { createPostgresLikeMutationStore } from '../../src/like-mutation-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_LIKE_MUTATION_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_LIKE_MUTATION_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const marker = 'w05-like-mutation-' + randomUUID()
const reportPath = process.env.W05_LIKE_MUTATION_POSTGRES_REPORT || '../../artifacts/neon/w05-like-mutation-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const store = createPostgresLikeMutationStore(client)
const actor = marker + '-actor'
const owner = marker + '-owner'
const contentId = marker + '-content'
const draftContentId = marker + '-draft'
const commentId = marker + '-comment'
const commentAuthor = marker + '-comment-author'
let contentInsertPassed = false
let contentIdempotencyPassed = false
let contentBlockRacePassed = false
let draftGuardPassed = false
let commentInsertPassed = false
let commentAuthorBlockRacePassed = false
let parentOwnerBlockRacePassed = false
let unlikePassed = false
let cleanupVerified = false

const policyExecutor = {
  prepare(sql) {
    return {
      bind(..._values) {
        return {
          async first() {
            if (sql.includes('FROM social_comments')) {
              const id = _values[0]
              const result = await client.query(
                'SELECT id, state, author_user_id, content_id FROM social_comments WHERE id = $1 LIMIT 1',
                [id],
              )
              return result.rows[0] ?? null
            }
            if (sql.includes('FROM social_user_interactions')) return { blocked: 0 }
            throw new Error('Unexpected policy query in PostgreSQL like-mutation rehearsal')
          },
        }
      },
    }
  },
}
const publishedBinding = {
  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init)
    const resolvedContentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json({
      data: {
        contentId: resolvedContentId,
        ownerUserId: owner,
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    })
  },
}
const expectNotFound = async (operation) => {
  await assert.rejects(operation, (error) =>
    error instanceof LikeRuntimeError && error.code === 'NOT_FOUND' && error.status === 404,
  )
}

try {
  // Isolate W03's publication row shape without creating or modifying its owned schema.
  await client.query('CREATE TEMP TABLE contents (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, state TEXT NOT NULL)')
  await client.query(
    'INSERT INTO contents (id, owner_user_id, state) VALUES ($1,$2,$3),($4,$2,$5)',
    [contentId, owner, 'PUBLISHED', draftContentId, 'DRAFT'],
  )
  await client.query(
    'INSERT INTO social_comments (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at) VALUES ($1,$2,$3,NULL,$4,$5,0,$6,now(),now())',
    [commentId, contentId, commentAuthor, 'synthetic rehearsal comment', 'PUBLISHED', marker + '-comment-key'],
  )

  const created = await like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: contentId },
    marker + '-content-correlation',
    undefined,
    store,
  )
  assert.equal(created.actorUserId, actor)
  assert.equal(created.targetId, contentId)
  contentInsertPassed = true

  const retried = await like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: contentId },
    marker + '-content-retry-correlation',
    undefined,
    store,
  )
  assert.equal(retried.relationshipId, created.relationshipId)
  const duplicateCount = await client.query(
    'SELECT count(*)::int AS rows FROM interaction_likes WHERE actor_user_id = $1 AND target_type = $2 AND target_id = $3',
    [actor, 'content', contentId],
  )
  assert.equal(duplicateCount.rows[0]?.rows, 1)
  contentIdempotencyPassed = true

  await expectNotFound(like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: draftContentId },
    marker + '-draft-correlation',
    undefined,
    store,
  ))
  draftGuardPassed = true

  const blockedContentId = marker + '-blocked-content'
  await client.query(
    'INSERT INTO contents (id, owner_user_id, state) VALUES ($1,$2,$3)',
    [blockedContentId, owner, 'PUBLISHED'],
  )
  await client.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())',
    [marker + '-block-forward', actor, owner, 'block'],
  )
  await expectNotFound(like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: blockedContentId },
    marker + '-block-forward-correlation',
    undefined,
    store,
  ))
  await client.query('DELETE FROM social_user_interactions WHERE relationship_id = $1', [marker + '-block-forward'])
  await client.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())',
    [marker + '-block-reverse', owner, actor, 'block'],
  )
  await expectNotFound(like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: blockedContentId },
    marker + '-block-reverse-correlation',
    undefined,
    store,
  ))
  contentBlockRacePassed = true
  await client.query('DELETE FROM social_user_interactions WHERE relationship_id = $1', [marker + '-block-reverse'])

  const commentCreated = await like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'comment', targetId: commentId },
    marker + '-comment-correlation',
    undefined,
    store,
  )
  assert.equal(commentCreated.targetType, 'comment')
  assert.equal(commentCreated.targetId, commentId)
  commentInsertPassed = true

  const blockedCommentId = marker + '-blocked-comment'
  await client.query(
    'INSERT INTO social_comments (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at) VALUES ($1,$2,$3,NULL,$4,$5,0,$6,now(),now())',
    [blockedCommentId, contentId, marker + '-blocked-comment-author', 'synthetic blocked comment', 'PUBLISHED', marker + '-blocked-comment-key'],
  )
  await client.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())',
    [marker + '-comment-block', actor, marker + '-blocked-comment-author', 'block'],
  )
  await expectNotFound(like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'comment', targetId: blockedCommentId },
    marker + '-comment-block-correlation',
    undefined,
    store,
  ))
  commentAuthorBlockRacePassed = true
  await client.query('DELETE FROM social_user_interactions WHERE relationship_id = $1', [marker + '-comment-block'])

  const parentBlockedCommentId = marker + '-parent-blocked-comment'
  await client.query(
    'INSERT INTO social_comments (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at) VALUES ($1,$2,$3,NULL,$4,$5,0,$6,now(),now())',
    [parentBlockedCommentId, contentId, marker + '-other-comment-author', 'synthetic parent-blocked comment', 'PUBLISHED', marker + '-parent-blocked-comment-key'],
  )
  await client.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())',
    [marker + '-parent-block', owner, actor, 'block'],
  )
  await expectNotFound(like(
    policyExecutor,
    publishedBinding,
    actor,
    { targetType: 'comment', targetId: parentBlockedCommentId },
    marker + '-parent-block-correlation',
    undefined,
    store,
  ))
  parentOwnerBlockRacePassed = true
  await client.query('DELETE FROM social_user_interactions WHERE relationship_id = $1', [marker + '-parent-block'])

  await unlike(policyExecutor, actor, { targetType: 'content', targetId: contentId }, store)
  const afterUnlike = await client.query(
    'SELECT count(*)::int AS rows FROM interaction_likes WHERE actor_user_id = $1 AND target_type = $2 AND target_id = $3',
    [actor, 'content', contentId],
  )
  assert.equal(afterUnlike.rows[0]?.rows, 0)
  unlikePassed = true
} finally {
  try {
    await client.query('DELETE FROM interaction_likes WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1', [marker + '%'])
    await client.query('DELETE FROM social_comments WHERE id LIKE $1 OR author_user_id LIKE $1', [marker + '%'])
    await client.query('DELETE FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1', [marker + '%'])
    const [likes, comments, relations] = await Promise.all([
      client.query('SELECT count(*)::int AS rows FROM interaction_likes WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1', [marker + '%']),
      client.query('SELECT count(*)::int AS rows FROM social_comments WHERE id LIKE $1 OR author_user_id LIKE $1', [marker + '%']),
      client.query('SELECT count(*)::int AS rows FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1', [marker + '%']),
    ])
    const remaining = (likes.rows[0]?.rows ?? -1) + (comments.rows[0]?.rows ?? -1) + (relations.rows[0]?.rows ?? -1)
    assert.equal(remaining, 0, 'All synthetic likes, comments and Block relations must be removed')
    cleanupVerified = true
    const passed = contentInsertPassed && contentIdempotencyPassed && contentBlockRacePassed &&
      draftGuardPassed && commentInsertPassed && commentAuthorBlockRacePassed &&
      parentOwnerBlockRacePassed && unlikePassed && cleanupVerified
    const report = {
      status: passed ? 'W05_LIKE_MUTATION_POSTGRES_RUNTIME_PASS' : 'W05_LIKE_MUTATION_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      contentLikeInsert: contentInsertPassed,
      contentLikeRetryIsIdempotent: contentIdempotencyPassed,
      contentBidirectionalBlockRaceRejected: contentBlockRacePassed,
      unpublishedContentFinalGuard: draftGuardPassed,
      publishedCommentLikeInsert: commentInsertPassed,
      commentAuthorBlockRaceRejected: commentAuthorBlockRacePassed,
      w03ParentOwnerBlockRaceRejected: parentOwnerBlockRacePassed,
      unlikeRemoval: unlikePassed,
      fixtureCleanupVerified: cleanupVerified,
      remainingFixtureRows: remaining,
      cloudflareD1Touched: false,
      remoteNeonTouched: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((passed ? 'W05_LIKE_MUTATION_POSTGRES_RUNTIME_PASS ' : 'W05_LIKE_MUTATION_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
    if (!passed) process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}
