import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createPostgresFavoriteMutationStore } from '../../src/favorite-mutation-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_FAVORITE_MUTATION_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_FAVORITE_MUTATION_POSTGRES_DATABASE_URL is required')

const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse favorite mutations outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}

const marker = 'w05-favorite-mutation-' + randomUUID()
const reportPath = process.env.W05_FAVORITE_MUTATION_POSTGRES_REPORT ||
  'artifacts/neon/w05-favorite-mutation-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000 })
const store = createPostgresFavoriteMutationStore(pool)
const actorA = marker + '-actor-a'
const actorB = marker + '-actor-b'
const targetId = marker + '-content'
const checks = {
  createsFavorite: false,
  duplicateCreatePreservesIdentity: false,
  duplicateCreatePreservesTimestamp: false,
  actorIsolation: false,
  removeIsIdempotent: false,
  cleanupVerified: false,
}
let passed = false

try {
  const first = await store.create({
    relationshipId: marker + '-relationship-a',
    actorUserId: actorA,
    targetType: 'content',
    targetId,
    createdAt: '2026-11-11T08:00:00.123Z',
  })
  assert.ok(first)
  assert.equal(first.relationship_id, marker + '-relationship-a')
  assert.equal(first.actor_user_id, actorA)
  assert.equal(first.target_id, targetId)
  checks.createsFavorite = true

  const duplicate = await store.create({
    relationshipId: marker + '-relationship-a-retry',
    actorUserId: actorA,
    targetType: 'content',
    targetId,
    createdAt: '2026-11-11T09:00:00.000Z',
  })
  assert.ok(duplicate)
  assert.equal(duplicate.relationship_id, first.relationship_id)
  checks.duplicateCreatePreservesIdentity = true
  assert.equal(duplicate.created_at, first.created_at)
  checks.duplicateCreatePreservesTimestamp = true

  const otherActor = await store.create({
    relationshipId: marker + '-relationship-b',
    actorUserId: actorB,
    targetType: 'content',
    targetId,
    createdAt: '2026-11-11T08:01:00.000Z',
  })
  assert.ok(otherActor)
  assert.equal(otherActor.relationship_id, marker + '-relationship-b')
  const rowsBeforeRemove = await pool.query(
    'SELECT actor_user_id, relationship_id FROM interaction_favorites WHERE target_id=$1 ORDER BY actor_user_id',
    [targetId],
  )
  assert.equal(rowsBeforeRemove.rows.length, 2)
  checks.actorIsolation = true

  await store.remove({ actorUserId: actorA, targetType: 'content', targetId })
  await store.remove({ actorUserId: actorA, targetType: 'content', targetId })
  const remaining = await pool.query(
    'SELECT actor_user_id, relationship_id FROM interaction_favorites WHERE target_id=$1',
    [targetId],
  )
  assert.deepEqual(remaining.rows, [{ actor_user_id: actorB, relationship_id: otherActor.relationship_id }])
  checks.removeIsIdempotent = true
  passed = true
} finally {
  try {
    await pool.query('DELETE FROM interaction_favorites WHERE target_id = $1', [targetId])
    const residual = await pool.query(
      'SELECT count(*)::int AS count FROM interaction_favorites WHERE target_id = $1',
      [targetId],
    )
    assert.deepEqual(residual.rows[0], { count: 0 })
    checks.cleanupVerified = true
    const report = {
      status: passed ? 'W05_FAVORITE_MUTATION_POSTGRES_RUNTIME_PASS' : 'W05_FAVORITE_MUTATION_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: residual.rows[0],
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      w03ContentAuthorityChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log((passed ? 'W05_FAVORITE_MUTATION_POSTGRES_RUNTIME_PASS ' : 'W05_FAVORITE_MUTATION_POSTGRES_RUNTIME_FAILED ') + JSON.stringify(report))
  } finally {
    await pool.end()
  }
}
