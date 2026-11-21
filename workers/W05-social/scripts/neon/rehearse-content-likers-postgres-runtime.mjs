import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { listContentLikers } from '../../src/like-list-runtime.ts'
import { createPostgresContentLikerReadStore } from '../../src/like-list-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_CONTENT_LIKERS_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_CONTENT_LIKERS_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 content liker rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-content-likers-' + randomUUID()
const reportPath = process.env.W05_CONTENT_LIKERS_POSTGRES_REPORT ||
  'artifacts/neon/w05-content-likers-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresContentLikerReadStore(pool)
let runtimePassed = false
const checks = {
  contentOwnerBlockExcluded: false,
  viewerToLikerBlockExcluded: false,
  viewerBlockToOwnerFailsClosed: false,
  anonymousViewerDoesNotApplyViewerSpecificBlock: false,
  newestFirstKeysetPagination: false,
  keysetCursorPreservesMicroseconds: false,
  nextPageHasNoDuplicates: false,
  cleanupVerified: false,
}

const insertLike = async (contentId, actorUserId, relationshipId, createdAt) => {
  await pool.query(
    'INSERT INTO interaction_likes (relationship_id, actor_user_id, target_type, target_id, created_at) VALUES ($1, $2, \'content\', $3, $4::timestamptz)',
    [relationshipId, actorUserId, contentId, createdAt],
  )
}

const insertBlock = async (actorUserId, targetUserId, relationshipId, createdAt) => {
  await pool.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, \'block\', $4::timestamptz, $4::timestamptz)',
    [relationshipId, actorUserId, targetUserId, createdAt],
  )
}

const context = (contentId, ownerUserId) => ({
  contentId,
  ownerUserId,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: '2026-11-10T00:00:00.000Z',
})

try {
  const contentId = marker + '-content'
  const contentOwnerId = marker + '-owner'
  const viewerId = marker + '-viewer'
  const ownerBlockedLiker = marker + '-owner-blocked-liker'
  const viewerBlockedLiker = marker + '-viewer-blocked-liker'
  const newestLiker = marker + '-newest-liker'
  const middleLiker = marker + '-middle-liker'
  const oldestLiker = marker + '-oldest-liker'

  await insertLike(contentId, ownerBlockedLiker, marker + '-like-owner-blocked', '2026-11-10T04:00:00.900000Z')
  await insertLike(contentId, viewerBlockedLiker, marker + '-like-viewer-blocked', '2026-11-10T04:00:00.800000Z')
  await insertLike(contentId, newestLiker, marker + '-like-newest', '2026-11-10T04:00:00.789123Z')
  await insertLike(contentId, middleLiker, marker + '-like-middle', '2026-11-10T04:00:00.456789Z')
  await insertLike(contentId, oldestLiker, marker + '-like-oldest', '2026-11-10T04:00:00.123456Z')

  // Exercise the reverse direction for both owner and viewer-to-liker Block checks.
  await insertBlock(ownerBlockedLiker, contentOwnerId, marker + '-block-owner-reverse', '2026-11-10T04:01:00.000001Z')
  await insertBlock(viewerBlockedLiker, viewerId, marker + '-block-viewer-reverse', '2026-11-10T04:01:00.000002Z')

  const firstPage = await listContentLikers(
    store, contentId, null, 1, viewerId, context(contentId, contentOwnerId),
  )
  assert.deepEqual(firstPage.items, [{
    userId: newestLiker,
    likedAt: '2026-11-10T04:00:00.789123Z',
  }])
  assert.equal(firstPage.hasMore, true)
  assert.ok(firstPage.nextCursor)
  checks.contentOwnerBlockExcluded = !firstPage.items.some(item => item.userId === ownerBlockedLiker)
  checks.viewerToLikerBlockExcluded = !firstPage.items.some(item => item.userId === viewerBlockedLiker)

  const secondPage = await listContentLikers(
    store, contentId, firstPage.nextCursor, 1, viewerId, context(contentId, contentOwnerId),
  )
  assert.deepEqual(secondPage.items, [{
    userId: middleLiker,
    likedAt: '2026-11-10T04:00:00.456789Z',
  }])
  assert.equal(secondPage.hasMore, true)

  const thirdPage = await listContentLikers(
    store, contentId, secondPage.nextCursor, 1, viewerId, context(contentId, contentOwnerId),
  )
  assert.deepEqual(thirdPage.items, [{
    userId: oldestLiker,
    likedAt: '2026-11-10T04:00:00.123456Z',
  }])
  assert.equal(thirdPage.hasMore, false)
  assert.equal(thirdPage.nextCursor, null)
  checks.newestFirstKeysetPagination = true
  checks.keysetCursorPreservesMicroseconds =
    firstPage.items[0]?.likedAt === '2026-11-10T04:00:00.789123Z' &&
    secondPage.items[0]?.likedAt === '2026-11-10T04:00:00.456789Z' &&
    thirdPage.items[0]?.likedAt === '2026-11-10T04:00:00.123456Z'
  const pagedIds = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map(item => item.userId)
  assert.deepEqual(pagedIds, [newestLiker, middleLiker, oldestLiker])
  assert.equal(new Set(pagedIds).size, 3)
  checks.nextPageHasNoDuplicates = true

  const anonymousPage = await listContentLikers(
    store, contentId, null, 10, null, context(contentId, contentOwnerId),
  )
  assert.deepEqual(anonymousPage.items.map(item => item.userId), [
    viewerBlockedLiker,
    newestLiker,
    middleLiker,
    oldestLiker,
  ])
  assert.equal(anonymousPage.items.some(item => item.userId === ownerBlockedLiker), false)
  checks.anonymousViewerDoesNotApplyViewerSpecificBlock = true

  const secondContentId = marker + '-blocked-owner-content'
  const secondOwnerId = marker + '-blocked-owner'
  await insertLike(secondContentId, marker + '-other-liker', marker + '-like-blocked-owner', '2026-11-10T04:02:00.000001Z')
  await insertBlock(viewerId, secondOwnerId, marker + '-block-viewer-owner', '2026-11-10T04:03:00.000001Z')
  const blockedOwnerPage = await listContentLikers(
    store, secondContentId, null, 10, viewerId, context(secondContentId, secondOwnerId),
  )
  assert.deepEqual(blockedOwnerPage.items, [])
  checks.viewerBlockToOwnerFailsClosed = true
  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM interaction_likes WHERE relationship_id LIKE $1 OR target_id LIKE $1 OR actor_user_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    const residual = await pool.query(
      'SELECT (SELECT count(*)::int FROM interaction_likes WHERE relationship_id LIKE $1 OR target_id LIKE $1 OR actor_user_id LIKE $1) AS likes, (SELECT count(*)::int FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1) AS blocks',
      [marker + '%'],
    )
    const remainingLikes = residual.rows[0]?.likes ?? -1
    const remainingBlocks = residual.rows[0]?.blocks ?? -1
    assert.equal(remainingLikes, 0, 'All synthetic like rows must be removed')
    assert.equal(remainingBlocks, 0, 'All synthetic Block rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_CONTENT_LIKERS_POSTGRES_RUNTIME_PASS' : 'W05_CONTENT_LIKERS_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: { likes: remainingLikes, blocks: remainingBlocks },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_CONTENT_LIKERS_POSTGRES_RUNTIME_PASS ' : 'W05_CONTENT_LIKERS_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
