import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { deleteContentPoll, SocialPollError } from '../../src/poll-runtime.ts'
import { createPostgresPollDeleteStore } from '../../src/poll-delete-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_POLL_DELETE_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_POLL_DELETE_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_POLL_DELETE_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-poll-delete-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const store = createPostgresPollDeleteStore(client)
const unusedD1 = { prepare() { throw new Error('Unexpected D1 access during PostgreSQL poll-delete rehearsal') } }
const marker = 'w05-poll-delete-' + randomUUID()
const owner = marker + '-owner'
const voter = marker + '-voter'
const now = new Date().toISOString()
const draftContext = (contentId) => ({
  contentId,
  ownerUserId: owner,
  contentType: 'post',
  state: 'DRAFT',
  updatedAt: now,
})

const fixturePoll = async ({ pollId, contentId, pollOwner = owner, optionIds = [], voteId = null }) => {
  await client.query(
    `INSERT INTO social_polls
      (poll_id, content_id, owner_user_id, duration_hours, duration_minutes, ends_at, created_at, updated_at)
     VALUES ($1, $2, $3, 24, 60, NULL, $4::timestamptz, $4::timestamptz)`,
    [pollId, contentId, pollOwner, now],
  )
  for (const [position, optionId] of optionIds.entries()) {
    await client.query(
      `INSERT INTO social_poll_options (option_id, poll_id, option_text, position)
       VALUES ($1, $2, $3, $4)`,
      [optionId, pollId, 'Option ' + (position + 1), position],
    )
  }
  if (voteId && optionIds[0]) {
    await client.query(
      `INSERT INTO social_poll_votes (vote_id, poll_id, option_id, user_id, created_at)
       VALUES ($1, $2, $3, $4, $5::timestamptz)`,
      [voteId, pollId, optionIds[0], voter, now],
    )
  }
}

const expectConflict = async (promise) => {
  await assert.rejects(promise, error =>
    error instanceof SocialPollError && error.code === 'CONFLICT' && error.status === 409,
  )
}

let unvotedDraftDeleted = false
let concurrentDeleteIsIdempotent = false
let votedDraftPreserved = false
let mismatchedPollOwnerPreserved = false
let cleanupPassed = false

const deletablePollId = marker + '-deletable-poll'
const deletableContentId = marker + '-deletable-content'
const deletableOptions = [marker + '-deletable-option-1', marker + '-deletable-option-2']
const votedPollId = marker + '-voted-poll'
const votedContentId = marker + '-voted-content'
const votedOptions = [marker + '-voted-option-1', marker + '-voted-option-2']
const voteId = marker + '-vote'
const mismatchPollId = marker + '-mismatch-poll'
const mismatchContentId = marker + '-mismatch-content'
const mismatchOptions = [marker + '-mismatch-option-1', marker + '-mismatch-option-2']

try {
  await fixturePoll({
    pollId: deletablePollId,
    contentId: deletableContentId,
    optionIds: deletableOptions,
  })
  await deleteContentPoll(unusedD1, owner, deletableContentId, draftContext(deletableContentId), store)
  const deletedPoll = await store.getPoll(deletableContentId)
  const deletedOptions = await client.query(
    'SELECT COUNT(*)::integer AS count FROM social_poll_options WHERE poll_id = $1',
    [deletablePollId],
  )
  assert.equal(deletedPoll, null)
  assert.equal(deletedOptions.rows[0]?.count, 0)
  unvotedDraftDeleted = true

  await deleteContentPoll(unusedD1, owner, deletableContentId, draftContext(deletableContentId), store)
  concurrentDeleteIsIdempotent = true

  await fixturePoll({
    pollId: votedPollId,
    contentId: votedContentId,
    optionIds: votedOptions,
    voteId,
  })
  await expectConflict(
    deleteContentPoll(unusedD1, owner, votedContentId, draftContext(votedContentId), store),
  )
  const preserved = await client.query(
    `SELECT
       (SELECT COUNT(*)::integer FROM social_polls WHERE poll_id = $1) AS polls,
       (SELECT COUNT(*)::integer FROM social_poll_options WHERE poll_id = $1) AS options,
       (SELECT COUNT(*)::integer FROM social_poll_votes WHERE poll_id = $1) AS votes`,
    [votedPollId],
  )
  assert.deepEqual(preserved.rows[0], { polls: 1, options: 2, votes: 1 })
  votedDraftPreserved = true

  await fixturePoll({
    pollId: mismatchPollId,
    contentId: mismatchContentId,
    pollOwner: marker + '-different-owner',
    optionIds: mismatchOptions,
  })
  await expectConflict(
    deleteContentPoll(unusedD1, owner, mismatchContentId, draftContext(mismatchContentId), store),
  )
  assert.equal((await store.getPoll(mismatchContentId))?.poll_id, mismatchPollId)
  mismatchedPollOwnerPreserved = true
} finally {
  try {
    await client.query('DELETE FROM social_poll_votes WHERE vote_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_poll_options WHERE option_id LIKE $1', [marker + '-%'])
    await client.query('DELETE FROM social_polls WHERE poll_id LIKE $1', [marker + '-%'])
    const residue = await client.query(
      `SELECT
         (SELECT COUNT(*)::integer FROM social_polls WHERE poll_id LIKE $1) AS polls,
         (SELECT COUNT(*)::integer FROM social_poll_options WHERE option_id LIKE $1) AS options,
         (SELECT COUNT(*)::integer FROM social_poll_votes WHERE vote_id LIKE $1) AS votes`,
      [marker + '-%'],
    )
    assert.deepEqual(residue.rows[0], { polls: 0, options: 0, votes: 0 })
    cleanupPassed = true
  } finally {
    client.release()
    await pool.end()
  }
}

const checks = {
  unvotedDraftDeleted,
  concurrentDeleteIsIdempotent,
  votedDraftPreserved,
  mismatchedPollOwnerPreserved,
  syntheticRowsRemoved: cleanupPassed,
}
if (Object.values(checks).some(value => value !== true)) {
  throw new Error('W05 PostgreSQL poll-delete rehearsal did not complete every assertion: ' + JSON.stringify(checks))
}
const report = {
  database: target.pathname.slice(1),
  postgresMajor: 18,
  checks,
  completedAt: new Date().toISOString(),
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05 PostgreSQL 18 poll-delete store rehearsal passed; synthetic rows removed')
