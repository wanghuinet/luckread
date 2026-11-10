import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { pinProfileContent, getProfilePinReference, unpinProfileContent } from '../../src/profile-pin-runtime.ts'
import { createPostgresProfilePinStore } from '../../src/profile-pin-store-postgres.ts'
import { createRepost, removeRepost } from '../../src/repost-runtime.ts'
import { createPostgresRepostStore } from '../../src/repost-store-postgres.ts'
import { createShare, resolveShare } from '../../src/share-runtime.ts'
import { createPostgresShareStore } from '../../src/share-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_PUBLICATION_RELATIONS_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_PUBLICATION_RELATIONS_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const marker = 'w05-publication-relations-' + randomUUID()
const reportPath = process.env.W05_PUBLICATION_RELATIONS_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-publication-relations-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const unusedD1 = { prepare() { throw new Error('Unexpected D1 access in PostgreSQL publication relation rehearsal') } }
const pinStore = createPostgresProfilePinStore(pool)
const repostStore = createPostgresRepostStore(pool)
const shareStore = createPostgresShareStore(pool)

const owner = marker + '-owner'
const pinContent = marker + '-pin-content'
const repostContent = marker + '-repost-content'
const blockedRepostContent = marker + '-blocked-repost-content'
const shareContent = marker + '-share-content'
const shareOtherContent = marker + '-share-other-content'
const actor = marker + '-actor'
const blockedActor = marker + '-blocked-actor'
const relationId = marker + '-block-relation'

const publishedBinding = {
  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init)
    const contentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
    return Response.json({
      data: {
        contentId,
        ownerUserId: owner,
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: '2026-11-10T00:00:00.000Z',
      },
    })
  },
}
const ownedPostContext = {
  contentId: pinContent,
  ownerUserId: owner,
  contentType: 'post',
  state: 'PUBLISHED',
  updatedAt: '2026-11-10T00:00:00.000Z',
}

let pinUpsertPassed = false
let pinReadAndDeletePassed = false
let repostIdempotencyPassed = false
let repostBlockPolicyPassed = false
let shareIdempotencyPassed = false
let shareVisibilityPassed = false

try {
  const firstPin = await pinProfileContent(unusedD1, owner, pinContent, ownedPostContext, pinStore)
  const secondPin = await pinProfileContent(unusedD1, owner, pinContent, ownedPostContext, pinStore)
  assert.equal(firstPin.userId, owner)
  assert.equal(firstPin.contentId, pinContent)
  assert.equal(secondPin.pinnedAt, firstPin.pinnedAt, 'pinning the same item must preserve pinned_at')
  pinUpsertPassed = true

  const readPin = await getProfilePinReference(unusedD1, owner, pinStore)
  assert.deepEqual(readPin, firstPin)
  await unpinProfileContent(unusedD1, owner, pinContent, pinStore)
  assert.equal(await getProfilePinReference(unusedD1, owner, pinStore), null)
  pinReadAndDeletePassed = true

  const firstRepost = await createRepost(
    unusedD1, publishedBinding, actor, repostContent, marker + '-repost-correlation', repostStore,
  )
  const repeatedRepost = await createRepost(
    unusedD1, publishedBinding, actor, repostContent, marker + '-repost-retry-correlation', repostStore,
  )
  assert.equal(repeatedRepost.repostId, firstRepost.repostId)
  assert.equal(repeatedRepost.createdAt, firstRepost.createdAt)
  await removeRepost(unusedD1, actor, repostContent, repostStore)
  assert.equal(await repostStore.find(actor, repostContent), null)
  repostIdempotencyPassed = true

  await pool.query(
    "INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, 'block', now(), now())",
    [relationId, blockedActor, owner],
  )
  await assert.rejects(
    createRepost(unusedD1, publishedBinding, blockedActor, blockedRepostContent, marker + '-blocked-correlation', repostStore),
    error => error?.code === 'NOT_FOUND' && error?.status === 404,
  )
  assert.equal(await repostStore.find(blockedActor, blockedRepostContent), null)
  repostBlockPolicyPassed = true

  const firstShare = await createShare(
    unusedD1, publishedBinding, actor, shareContent, marker + '-share-idempotency-key',
    marker + '-share-create-correlation', shareStore,
  )
  const repeatedShare = await createShare(
    unusedD1, publishedBinding, actor, shareContent, marker + '-share-idempotency-key',
    marker + '-share-retry-correlation', shareStore,
  )
  assert.equal(repeatedShare.shareId, firstShare.shareId)
  assert.equal(repeatedShare.createdAt, firstShare.createdAt)
  shareIdempotencyPassed = true

  const resolved = await resolveShare(
    unusedD1, publishedBinding, firstShare.shareId, marker + '-share-resolve-correlation', shareStore,
  )
  assert.deepEqual(resolved, {
    shareId: firstShare.shareId,
    contentId: shareContent,
    createdAt: firstShare.createdAt,
  })
  await assert.rejects(
    createShare(
      unusedD1, publishedBinding, actor, shareOtherContent, marker + '-share-idempotency-key',
      marker + '-share-conflict-correlation', shareStore,
    ),
    error => error?.code === 'CONFLICT' && error?.status === 409,
  )
  shareVisibilityPassed = true
} finally {
  try {
    await pool.query('DELETE FROM social_profile_pins WHERE user_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_reposts WHERE actor_user_id LIKE $1 OR content_id LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_share_links WHERE share_id LIKE $1 OR actor_user_id LIKE $1 OR idempotency_key LIKE $1', [marker + '%'])
    await pool.query('DELETE FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1', [marker + '%'])

    const counts = await pool.query(
      "SELECT (SELECT count(*)::int FROM social_profile_pins WHERE user_id LIKE $1) + " +
      "(SELECT count(*)::int FROM social_reposts WHERE actor_user_id LIKE $1 OR content_id LIKE $1) + " +
      "(SELECT count(*)::int FROM social_share_links WHERE share_id LIKE $1 OR actor_user_id LIKE $1 OR idempotency_key LIKE $1) + " +
      "(SELECT count(*)::int FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1) AS rows",
      [marker + '%'],
    )
    const remaining = counts.rows[0]?.rows ?? -1
    assert.equal(remaining, 0, 'All synthetic relation fixtures must be removed')

    const passed = pinUpsertPassed && pinReadAndDeletePassed && repostIdempotencyPassed &&
      repostBlockPolicyPassed && shareIdempotencyPassed && shareVisibilityPassed
    const report = {
      status: passed ? 'W05_PUBLICATION_RELATIONS_POSTGRES_RUNTIME_PASS' : 'W05_PUBLICATION_RELATIONS_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      profilePinUpsertPreservesTimestamp: pinUpsertPassed,
      profilePinReadAndDelete: pinReadAndDeletePassed,
      repostIdempotencyAndRemoval: repostIdempotencyPassed,
      repostBidirectionalBlockPolicy: repostBlockPolicyPassed,
      shareIdempotency: shareIdempotencyPassed,
      shareResolveRevalidatesW03AndKeyConflict: shareVisibilityPassed,
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
    console.log((passed ? 'W05_PUBLICATION_RELATIONS_POSTGRES_RUNTIME_PASS ' : 'W05_PUBLICATION_RELATIONS_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
    if (!passed) process.exitCode = 1
  } finally {
    await pool.end()
  }
}
