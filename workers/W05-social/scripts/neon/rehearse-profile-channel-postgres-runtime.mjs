import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { listProfileLikedContents, listProfileReplies } from '../../src/profile-channel-runtime.ts'
import { createPostgresProfileChannelReadStore } from '../../src/profile-channel-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.W05_PROFILE_CHANNEL_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_PROFILE_CHANNEL_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_w05_d1_02_schema'
) {
  throw new Error('Refusing to run W05 Profile Channel rehearsal outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-profile-channel-' + randomUUID()
const reportPath = process.env.W05_PROFILE_CHANNEL_POSTGRES_REPORT ||
  'artifacts/neon/w05-profile-channel-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresProfileChannelReadStore(pool)
let runtimePassed = false
const checks = {
  profileRepliesRespectBidirectionalBlock: false,
  profileRepliesRespectViewerDirectedMute: false,
  replyOwnerBlockFilteringPreserved: false,
  replyPublicationContextFailsClosed: false,
  replyKeysetPaginationPreservesMicroseconds: false,
  replyNextPageHasNoDuplicates: false,
  likedContentsRespectProfileAndViewerBlock: false,
  likedContentsRespectViewerDirectedMute: false,
  likedContentsRespectPublicationContext: false,
  likedContentKeysetPaginationPreservesMicroseconds: false,
  likedContentNextPageHasNoDuplicates: false,
  cleanupVerified: false,
}

const insertComment = async (id, contentId, authorId, createdAt) => {
  await pool.query(
    'INSERT INTO social_comments (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at) VALUES ($1, $2, $3, NULL, $4, \'PUBLISHED\', 0, $5, $6::timestamptz, $6::timestamptz)',
    [id, contentId, authorId, 'reply-' + id, 'profile channel rehearsal', marker + '-' + id, createdAt],
  )
}

const insertLike = async (id, profileId, contentId, createdAt) => {
  await pool.query(
    'INSERT INTO interaction_likes (relationship_id, actor_user_id, target_type, target_id, created_at) VALUES ($1, $2, \'content\', $3, $4::timestamptz)',
    [id, profileId, contentId, createdAt],
  )
}

const insertInteraction = async (id, actorId, targetId, relationType, createdAt) => {
  await pool.query(
    'INSERT INTO social_user_interactions (relationship_id, actor_user_id, target_user_id, relation_type, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz)',
    [id, actorId, targetId, relationType, createdAt],
  )
}

const contexts = new Map()
const w03Content = {
  async fetch(input, init) {
    const request = input instanceof Request ? input : new Request(input, init)
    const body = await request.clone().json()
    return Response.json({
      data: {
        items: body.contentIds.flatMap(contentId => {
          const context = contexts.get(contentId)
          return context ? [context] : []
        }),
      },
    })
  },
}

const setContext = (contentId, ownerUserId, state = 'PUBLISHED') => {
  contexts.set(contentId, {
    contentId,
    ownerUserId,
    contentType: 'post',
    state,
    updatedAt: '2026-11-11T00:00:00.000Z',
  })
}

try {
  const profile = marker + '-profile'
  const viewer = marker + '-viewer'
  const contentVisible = marker + '-content-visible'
  const contentBlockedOwner = marker + '-content-blocked-owner'
  const contentUnpublished = marker + '-content-unpublished'
  const ownerVisible = marker + '-owner-visible'
  const ownerBlocked = marker + '-owner-blocked'
  const ownerMuted = marker + '-owner-muted'

  setContext(contentVisible, ownerVisible)
  setContext(contentBlockedOwner, ownerBlocked)
  setContext(contentUnpublished, ownerVisible, 'DRAFT')

  await insertComment(marker + '-reply-visible', contentVisible, profile, '2026-11-11T04:00:00.789123Z')
  await insertComment(marker + '-reply-blocked-owner', contentBlockedOwner, profile, '2026-11-11T04:00:00.700000Z')
  await insertComment(marker + '-reply-unpublished', contentUnpublished, profile, '2026-11-11T04:00:00.600000Z')
  await insertInteraction(marker + '-reply-owner-block', ownerBlocked, profile, 'block', '2026-11-11T04:01:00.000001Z')

  const replyVisibility = await listProfileReplies(
    store, w03Content, profile, null, 10, viewer, marker + '-replies-visible',
  )
  assert.deepEqual(replyVisibility.items.map(item => item.id), [marker + '-reply-visible'])
  checks.profileRepliesRespectBidirectionalBlock = !replyVisibility.items.some(item => item.id === marker + '-reply-blocked-owner')
  checks.replyOwnerBlockFilteringPreserved = checks.profileRepliesRespectBidirectionalBlock
  checks.replyPublicationContextFailsClosed = !replyVisibility.items.some(item => item.id === marker + '-reply-unpublished')

  await insertInteraction(marker + '-viewer-profile-mute', viewer, profile, 'mute', '2026-11-11T04:02:00.000001Z')
  const mutedProfileReplies = await listProfileReplies(
    store, w03Content, profile, null, 10, viewer, marker + '-replies-muted',
  )
  assert.deepEqual(mutedProfileReplies.items, [])
  checks.profileRepliesRespectViewerDirectedMute = true

  // A reverse-direction Mute must not hide a profile channel.
  await pool.query(
    'DELETE FROM social_user_interactions WHERE relationship_id = $1',
    [marker + '-viewer-profile-mute'],
  )
  await insertInteraction(marker + '-profile-viewer-mute', profile, viewer, 'mute', '2026-11-11T04:03:00.000001Z')
  const reverseMutedProfileReplies = await listProfileReplies(
    store, w03Content, profile, null, 10, viewer, marker + '-replies-reverse-muted',
  )
  assert.equal(reverseMutedProfileReplies.items.length, 1)
  await pool.query(
    'DELETE FROM social_user_interactions WHERE relationship_id = $1',
    [marker + '-profile-viewer-mute'],
  )

  const paginationProfile = marker + '-pagination-profile'
  const paginationContentA = marker + '-pagination-content-a'
  const paginationContentB = marker + '-pagination-content-b'
  const paginationContentC = marker + '-pagination-content-c'
  setContext(paginationContentA, marker + '-pagination-owner')
  setContext(paginationContentB, marker + '-pagination-owner')
  setContext(paginationContentC, marker + '-pagination-owner')
  await insertComment(marker + '-reply-page-a', paginationContentA, paginationProfile, '2026-11-11T05:00:00.789123Z')
  await insertComment(marker + '-reply-page-b', paginationContentB, paginationProfile, '2026-11-11T05:00:00.456789Z')
  await insertComment(marker + '-reply-page-c', paginationContentC, paginationProfile, '2026-11-11T05:00:00.123456Z')

  const replyPage1 = await listProfileReplies(
    store, w03Content, paginationProfile, null, 1, null, marker + '-replies-page-1',
  )
  const replyPage2 = await listProfileReplies(
    store, w03Content, paginationProfile, replyPage1.nextCursor, 1, null, marker + '-replies-page-2',
  )
  const replyPage3 = await listProfileReplies(
    store, w03Content, paginationProfile, replyPage2.nextCursor, 1, null, marker + '-replies-page-3',
  )
  assert.deepEqual(replyPage1.items.map(item => item.id), [marker + '-reply-page-a'])
  assert.deepEqual(replyPage2.items.map(item => item.id), [marker + '-reply-page-b'])
  assert.deepEqual(replyPage3.items.map(item => item.id), [marker + '-reply-page-c'])
  assert.equal(replyPage1.items[0]?.createdAt, '2026-11-11T05:00:00.789123Z')
  assert.equal(replyPage2.items[0]?.createdAt, '2026-11-11T05:00:00.456789Z')
  assert.equal(replyPage3.items[0]?.createdAt, '2026-11-11T05:00:00.123456Z')
  assert.equal(replyPage3.hasMore, false)
  const replyIds = [...replyPage1.items, ...replyPage2.items, ...replyPage3.items].map(item => item.id)
  assert.equal(new Set(replyIds).size, 3)
  checks.replyKeysetPaginationPreservesMicroseconds = true
  checks.replyNextPageHasNoDuplicates = true

  const likedProfile = marker + '-liked-profile'
  const likedViewer = marker + '-liked-viewer'
  const likeVisible = marker + '-like-visible'
  const likeBlocked = marker + '-like-blocked'
  const likeMuted = marker + '-like-muted'
  const likeUnpublished = marker + '-like-unpublished'
  setContext(likeVisible, marker + '-liked-owner-visible')
  setContext(likeBlocked, marker + '-liked-owner-blocked')
  setContext(likeMuted, ownerMuted)
  setContext(likeUnpublished, marker + '-liked-owner-unpublished', 'DRAFT')

  await insertLike(marker + '-liked-visible', likedProfile, likeVisible, '2026-11-11T06:00:00.789123Z')
  await insertLike(marker + '-liked-blocked', likedProfile, likeBlocked, '2026-11-11T06:00:00.700000Z')
  await insertLike(marker + '-liked-muted', likedProfile, likeMuted, '2026-11-11T06:00:00.600000Z')
  await insertLike(marker + '-liked-unpublished', likedProfile, likeUnpublished, '2026-11-11T06:00:00.500000Z')
  await insertInteraction(marker + '-liked-owner-block', likedViewer, marker + '-liked-owner-blocked', 'block', '2026-11-11T06:01:00.000001Z')
  await insertInteraction(marker + '-liked-owner-mute', likedViewer, ownerMuted, 'mute', '2026-11-11T06:01:00.000002Z')

  const likedPage = await listProfileLikedContents(
    store, w03Content, likedProfile, null, 10, likedViewer, marker + '-liked-visibility',
  )
  assert.deepEqual(likedPage.items, [{
    contentId: likeVisible,
    likedAt: '2026-11-11T06:00:00.789123Z',
  }])
  checks.likedContentsRespectProfileAndViewerBlock = !likedPage.items.some(item => item.contentId === likeBlocked)
  checks.likedContentsRespectViewerDirectedMute = !likedPage.items.some(item => item.contentId === likeMuted)
  checks.likedContentsRespectPublicationContext = !likedPage.items.some(item => item.contentId === likeUnpublished)

  const likedPaginationProfile = marker + '-liked-pagination-profile'
  const likedPaginationContentA = marker + '-liked-page-a'
  const likedPaginationContentB = marker + '-liked-page-b'
  const likedPaginationContentC = marker + '-liked-page-c'
  setContext(likedPaginationContentA, marker + '-liked-pagination-owner')
  setContext(likedPaginationContentB, marker + '-liked-pagination-owner')
  setContext(likedPaginationContentC, marker + '-liked-pagination-owner')
  await insertLike(marker + '-liked-page-a', likedPaginationProfile, likedPaginationContentA, '2026-11-11T07:00:00.789123Z')
  await insertLike(marker + '-liked-page-b', likedPaginationProfile, likedPaginationContentB, '2026-11-11T07:00:00.456789Z')
  await insertLike(marker + '-liked-page-c', likedPaginationProfile, likedPaginationContentC, '2026-11-11T07:00:00.123456Z')

  const likedPage1 = await listProfileLikedContents(
    store, w03Content, likedPaginationProfile, null, 1, null, marker + '-liked-page-1',
  )
  const likedPage2 = await listProfileLikedContents(
    store, w03Content, likedPaginationProfile, likedPage1.nextCursor, 1, null, marker + '-liked-page-2',
  )
  const likedPage3 = await listProfileLikedContents(
    store, w03Content, likedPaginationProfile, likedPage2.nextCursor, 1, null, marker + '-liked-page-3',
  )
  assert.deepEqual(likedPage1.items.map(item => item.contentId), [likedPaginationContentA])
  assert.deepEqual(likedPage2.items.map(item => item.contentId), [likedPaginationContentB])
  assert.deepEqual(likedPage3.items.map(item => item.contentId), [likedPaginationContentC])
  assert.equal(likedPage1.items[0]?.likedAt, '2026-11-11T07:00:00.789123Z')
  assert.equal(likedPage2.items[0]?.likedAt, '2026-11-11T07:00:00.456789Z')
  assert.equal(likedPage3.items[0]?.likedAt, '2026-11-11T07:00:00.123456Z')
  assert.equal(likedPage3.hasMore, false)
  const likedIds = [...likedPage1.items, ...likedPage2.items, ...likedPage3.items].map(item => item.contentId)
  assert.equal(new Set(likedIds).size, 3)
  checks.likedContentKeysetPaginationPreservesMicroseconds = true
  checks.likedContentNextPageHasNoDuplicates = true

  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM social_comments WHERE id LIKE $1 OR author_user_id LIKE $1 OR content_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM interaction_likes WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1',
      [marker + '%'],
    )
    await pool.query(
      'DELETE FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1',
      [marker + '%'],
    )
    const residual = await pool.query(
      'SELECT (SELECT count(*)::int FROM social_comments WHERE id LIKE $1 OR author_user_id LIKE $1 OR content_id LIKE $1) AS comments, (SELECT count(*)::int FROM interaction_likes WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1) AS likes, (SELECT count(*)::int FROM social_user_interactions WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_user_id LIKE $1) AS interactions',
      [marker + '%'],
    )
    const remaining = residual.rows[0] ?? { comments: -1, likes: -1, interactions: -1 }
    assert.equal(remaining.comments, 0, 'All synthetic profile comment rows must be removed')
    assert.equal(remaining.likes, 0, 'All synthetic profile like rows must be removed')
    assert.equal(remaining.interactions, 0, 'All synthetic Block/Mute rows must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed ? 'W05_PROFILE_CHANNEL_POSTGRES_RUNTIME_PASS' : 'W05_PROFILE_CHANNEL_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: remaining,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((runtimePassed ? 'W05_PROFILE_CHANNEL_POSTGRES_RUNTIME_PASS ' : 'W05_PROFILE_CHANNEL_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
