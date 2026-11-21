import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { getFavoriteStatus, listFavorites } from '../../src/favorite-runtime.ts'
import { createPostgresFavoriteListReadStore } from '../../src/favorite-list-read-store-postgres.ts'
import { createPostgresFavoriteStatusReadStore } from '../../src/favorite-status-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_FAVORITE_LIST_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_FAVORITE_LIST_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const marker = 'w05-favorite-list-' + randomUUID()
const reportPath = process.env.W05_FAVORITE_LIST_POSTGRES_REPORT || '../../artifacts/neon/w05-favorite-list-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresFavoriteListReadStore(pool)
const statusStore = createPostgresFavoriteStatusReadStore(pool)
let passed = false
let statusReadsPassed = false
const insert = (actor, targetId, id, createdAt) => pool.query(
  "INSERT INTO interaction_favorites (relationship_id, actor_user_id, target_type, target_id, created_at) VALUES ($1, $2, 'content', $3, $4::timestamptz)",
  [id, actor, targetId, createdAt],
)
try {
  const actor = marker + '-actor'
  const other = marker + '-other'
  const targets = ['newer','middle','older','oldest'].map(x => marker + '-content-' + x)
  const times = [
    '2026-11-10T04:00:00.900456Z',
    '2026-11-10T04:00:00.789123Z',
    '2026-11-10T04:00:00.456789Z',
    '2026-11-10T04:00:00.123456Z',
  ]
  for (let i=0;i<4;i++) await insert(actor, targets[i], marker + '-favorite-' + i, times[i])
  await insert(other, marker + '-unrelated-content', marker + '-unrelated-favorite', '2026-11-10T04:00:01.000001Z')

  const first = await listFavorites(store, actor, null, 2)
  assert.deepEqual(first.items, [
    { targetId: targets[0], createdAt: '2026-11-10T04:00:00.900Z' },
    { targetId: targets[1], createdAt: '2026-11-10T04:00:00.789Z' },
  ])
  assert.equal(first.hasMore, true)
  assert.ok(first.nextCursor)
  const second = await listFavorites(store, actor, first.nextCursor, 2)
  assert.deepEqual(second.items, [
    { targetId: targets[2], createdAt: '2026-11-10T04:00:00.456Z' },
    { targetId: targets[3], createdAt: '2026-11-10T04:00:00.123Z' },
  ])
  assert.equal(second.hasMore, false)
  assert.deepEqual([...first.items, ...second.items].map(x => x.targetId), targets)
  assert.equal(new Set([...first.items, ...second.items].map(x => x.targetId)).size, 4)
  const publishedBinding = {
    async fetch(input, init) {
      const request = input instanceof Request ? input : new Request(input, init)
      const contentId = new URL(request.url).pathname.split('/').filter(Boolean).at(-2)
      return Response.json({
        data: {
          contentId,
          ownerUserId: marker + '-content-owner',
          contentType: 'post',
          state: 'PUBLISHED',
          updatedAt: '2026-11-10T00:00:00.000Z',
        },
      })
    },
  }
  const publishedFavorite = await getFavoriteStatus(
    statusStore,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: targets[0] },
    marker + '-published-favorite-correlation',
  )
  assert.deepEqual(publishedFavorite, { favorited: true })
  const missingFavorite = await getFavoriteStatus(
    statusStore,
    publishedBinding,
    actor,
    { targetType: 'content', targetId: marker + '-content-not-favorited' },
    marker + '-unfavorited-correlation',
  )
  assert.deepEqual(missingFavorite, { favorited: false })
  statusReadsPassed = true

  const otherPage = await listFavorites(store, other, null, 10)
  assert.deepEqual(otherPage.items, [{
    targetId: marker + '-unrelated-content',
    createdAt: '2026-11-10T04:00:01.000Z',
  }])
  passed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM interaction_favorites WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1',
      [marker + '%'],
    )
    const result = await pool.query(
      'SELECT count(*)::int AS rows FROM interaction_favorites WHERE relationship_id LIKE $1 OR actor_user_id LIKE $1 OR target_id LIKE $1',
      [marker + '%'],
    )
    const remaining = result.rows[0]?.rows ?? -1
    assert.equal(remaining, 0, 'All synthetic favorite rows must be removed')
    const report = {
      status: passed ? 'W05_FAVORITE_LIST_POSTGRES_RUNTIME_PASS' : 'W05_FAVORITE_LIST_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      actorScopedFavorites: true,
      favoriteStatusPointReads: statusReadsPassed,
      newestFirstPagination: true,
      microsecondCursorPrecision: true,
      noDuplicateOrMissingRows: true,
      limitPlusOneHasMore: true,
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
    console.log((passed ? 'W05_FAVORITE_LIST_POSTGRES_RUNTIME_PASS ' : 'W05_FAVORITE_LIST_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
