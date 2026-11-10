import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { deleteComment, updateComment, CommentRuntimeError } from '../../src/comment-runtime.ts'
import { createPostgresCommentMutationStore } from '../../src/comment-mutation-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_COMMENT_MUTATION_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_COMMENT_MUTATION_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_COMMENT_MUTATION_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-comment-mutation-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const store = createPostgresCommentMutationStore(client)
const unusedD1 = { prepare() { throw new Error('Unexpected D1 access during PostgreSQL comment-mutation rehearsal') } }
const marker = 'w05-comment-mutation-' + randomUUID()
const contentId = marker + '-content'
const actor = marker + '-actor'
const otherActor = marker + '-other'
const binding = {
  async fetch(input) {
    const request = input instanceof Request ? input : new Request(input)
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    const requestedContentId = decodeURIComponent(parts.at(-2) ?? '')
    return Response.json({
      data: {
        contentId: requestedContentId,
        ownerUserId: marker + '-owner',
        contentType: 'post',
        state: 'PUBLISHED',
        updatedAt: new Date().toISOString(),
      },
    })
  },
}

const insertFixture = async (id, authorUserId, body = 'fixture', parentId = null) => {
  await client.query(
    `INSERT INTO social_comments
      (id, content_id, author_user_id, parent_id, body, state, depth, idempotency_key, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'PUBLISHED', $6, $7, date_trunc('milliseconds', NOW() - INTERVAL '2 minutes'), date_trunc('milliseconds', NOW() - INTERVAL '1 minute'))`,
    [id, contentId, authorUserId, parentId, body, parentId ? 1 : 0, id + '-key'],
  )
}

const expectRuntimeError = async (promise, code, status) => {
  await assert.rejects(promise, error =>
    error instanceof CommentRuntimeError && error.code === code && error.status === status,
  )
}

let editPassed = false
let editReplayPassed = false
let staleEditRejected = false
let editRaceRejected = false
let deletePassed = false
let deleteReplayPassed = false
let deleteWithRepliesRejected = false
let deleteRaceRejected = false
let cleanupPassed = false

try {
  const updateId = marker + '-update'
  await insertFixture(updateId, actor, 'before')
  const before = await store.getForUpdate(updateId)
  assert.ok(before?.updated_at)
  const updateResult = await updateComment(
    unusedD1, binding, actor, updateId,
    { body: 'after', ifMatch: '"' + before.updated_at + '"' },
    marker + '-correlation', store,
  )
  assert.equal(updateResult.item.body, 'after')
  assert.equal(updateResult.etag, '"' + updateResult.item.updatedAt + '"')
  editPassed = true

  const replay = await updateComment(
    unusedD1, binding, actor, updateId,
    { body: 'after', ifMatch: '"' + before.updated_at + '"' },
    marker + '-correlation-replay', store,
  )
  assert.equal(replay.item.updatedAt, updateResult.item.updatedAt)
  editReplayPassed = true

  await expectRuntimeError(
    updateComment(
      unusedD1, binding, actor, updateId,
      { body: 'stale payload', ifMatch: '"' + before.updated_at + '"' },
      marker + '-correlation-stale', store,
    ),
    'PRECONDITION_FAILED', 412,
  )
  staleEditRejected = true

  const raceUpdateId = marker + '-update-race'
  await insertFixture(raceUpdateId, actor, 'race-before')
  const raceBefore = await store.getForUpdate(raceUpdateId)
  assert.ok(raceBefore?.updated_at)
  const raceUpdateStore = {
    ...store,
    async getForUpdate(id) {
      const row = await store.getForUpdate(id)
      await client.query(
        "UPDATE social_comments SET updated_at = NOW() + INTERVAL '2 seconds' WHERE id = $1",
        [id],
      )
      return row
    },
  }
  await expectRuntimeError(
    updateComment(
      unusedD1, binding, actor, raceUpdateId,
      { body: 'race-after', ifMatch: '"' + raceBefore.updated_at + '"' },
      marker + '-correlation-race-update', raceUpdateStore,
    ),
    'PRECONDITION_FAILED', 412,
  )
  editRaceRejected = true

  const deleteId = marker + '-delete'
  await insertFixture(deleteId, actor, 'delete-me')
  assert.equal(
    await deleteComment(unusedD1, binding, actor, deleteId, marker + '-correlation-delete', store),
    contentId,
  )
  assert.equal(await store.getDeleteState(deleteId, actor), 'AUTHOR_DELETED')
  deletePassed = true

  assert.equal(
    await deleteComment(unusedD1, undefined, actor, deleteId, marker + '-correlation-delete-replay', store),
    contentId,
  )
  deleteReplayPassed = true

  const parentId = marker + '-delete-with-replies'
  const childId = marker + '-delete-child'
  await insertFixture(parentId, actor, 'parent')
  await insertFixture(childId, otherActor, 'child', parentId)
  await expectRuntimeError(
    deleteComment(unusedD1, binding, actor, parentId, marker + '-correlation-has-replies', store),
    'CONFLICT', 409,
  )
  deleteWithRepliesRejected = true

  const raceDeleteId = marker + '-delete-race'
  const raceChildId = marker + '-delete-race-child'
  await insertFixture(raceDeleteId, actor, 'race-delete')
  const raceDeleteStore = {
    ...store,
    async markDeleted(input) {
      await insertFixture(raceChildId, otherActor, 'racing child', raceDeleteId)
      return store.markDeleted(input)
    },
  }
  await expectRuntimeError(
    deleteComment(unusedD1, binding, actor, raceDeleteId, marker + '-correlation-race-delete', raceDeleteStore),
    'CONFLICT', 409,
  )
  deleteRaceRejected = true
} finally {
  try {
    await client.query('DELETE FROM social_comments WHERE id LIKE $1', [marker + '-%'])
    const residue = await client.query(
      'SELECT COUNT(*)::integer AS count FROM social_comments WHERE id LIKE $1',
      [marker + '-%'],
    )
    assert.equal(residue.rows[0]?.count, 0)
    cleanupPassed = true
  } finally {
    client.release()
    await pool.end()
  }
}

const checks = {
  editCompareAndSwap: editPassed,
  editReplay: editReplayPassed,
  staleEditRejected,
  concurrentEditRejected: editRaceRejected,
  deleteTombstone: deletePassed,
  deleteReplay: deleteReplayPassed,
  deleteWithRepliesRejected,
  concurrentReplyPreventsDelete: deleteRaceRejected,
  syntheticRowsRemoved: cleanupPassed,
}
if (Object.values(checks).some(value => value !== true)) {
  throw new Error('W05 PostgreSQL comment-mutation rehearsal did not complete every assertion: ' + JSON.stringify(checks))
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor: 18,
  checks,
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 PostgreSQL 18 comment-mutation store rehearsal passed; synthetic rows removed')
