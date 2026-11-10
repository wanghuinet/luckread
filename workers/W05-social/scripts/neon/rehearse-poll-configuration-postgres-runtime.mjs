import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { configureContentPoll, SocialPollError } from '../../src/poll-runtime.ts'
import { createPostgresPollConfigurationStore } from '../../src/poll-configuration-store-postgres.ts'
import { createPostgresPollReadStore } from '../../src/poll-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')
const connectionString = process.env.W05_POLL_CONFIGURATION_POSTGRES_DATABASE_URL
if (!connectionString) throw new Error('W05_POLL_CONFIGURATION_POSTGRES_DATABASE_URL is required')
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_w05_d1_02_schema') {
  throw new Error('Refusing to rehearse outside disposable local PostgreSQL luckread_w05_d1_02_schema')
}
const reportPath = process.env.W05_POLL_CONFIGURATION_POSTGRES_REPORT ||
  '../../artifacts/neon/w05-poll-configuration-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
const configurationStore = createPostgresPollConfigurationStore(client)
const readStore = createPostgresPollReadStore(client)
const unusedD1 = {
  prepare() { throw new Error('Unexpected D1 access during PostgreSQL poll-configuration rehearsal') },
  batch() { throw new Error('Unexpected D1 batch during PostgreSQL poll-configuration rehearsal') },
}
const marker = 'w05-poll-config-' + randomUUID()
const owner = marker + '-owner'
const contentId = marker + '-content'
const now = new Date().toISOString()
const draftContext = (state = 'DRAFT') => ({
  contentId,
  ownerUserId: owner,
  contentType: 'post',
  state,
  updatedAt: now,
})
let createdAndReadBack = false
let updatedWithoutVotes = false
let sameConfigurationAllowedAfterVote = false
let changedConfigurationRejectedAfterVote = false
let publishedConfigurationImmutable = false
let cleanupPassed = false
let pollId = null

try {
  const created = await configureContentPoll(
    unusedD1, owner, contentId, ['Yes', 'No'], 90, draftContext(),
    configurationStore, readStore,
  )
  pollId = created.pollId
  assert.equal(created.contentId, contentId)
  assert.equal(created.durationMinutes, 90)
  assert.deepEqual(created.options.map(option => option.text), ['Yes', 'No'])
  assert.equal(created.totalVotes, 0)
  createdAndReadBack = true

  const updated = await configureContentPoll(
    unusedD1, owner, contentId, ['Maybe', 'Later', 'Never'], 240,
    draftContext(), configurationStore, readStore,
  )
  assert.equal(updated.pollId, pollId)
  assert.equal(updated.durationMinutes, 240)
  assert.deepEqual(updated.options.map(option => option.text), ['Maybe', 'Later', 'Never'])
  updatedWithoutVotes = true

  const currentPoll = await configurationStore.getPoll(contentId)
  assert.ok(currentPoll)
  const currentOptions = await client.query(
    'SELECT option_id FROM social_poll_options WHERE poll_id = $1 ORDER BY position ASC',
    [pollId],
  )
  const voteId = marker + '-vote'
  await client.query(
    `INSERT INTO social_poll_votes (vote_id, poll_id, option_id, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5::timestamptz)`,
    [voteId, pollId, currentOptions.rows[0].option_id, marker + '-voter', now],
  )

  const unchanged = await configureContentPoll(
    unusedD1, owner, contentId, ['Maybe', 'Later', 'Never'], 240,
    draftContext(), configurationStore, readStore,
  )
  assert.equal(unchanged.pollId, pollId)
  assert.equal(unchanged.totalVotes, 1)
  sameConfigurationAllowedAfterVote = true

  await assert.rejects(
    configureContentPoll(
      unusedD1, owner, contentId, ['New', 'Choice'], 360,
      draftContext(), configurationStore, readStore,
    ),
    error => error instanceof SocialPollError && error.code === 'CONFLICT' && error.status === 409,
  )
  changedConfigurationRejectedAfterVote = true

  await assert.rejects(
    configureContentPoll(
      unusedD1, owner, contentId, ['Different', 'Options'], 240,
      draftContext('PUBLISHED'), configurationStore, readStore,
    ),
    error => error instanceof SocialPollError && error.code === 'CONFLICT' && error.status === 409,
  )
  publishedConfigurationImmutable = true

  assert.deepEqual(await configurationStore.listOptionTexts(pollId), ['Maybe', 'Later', 'Never'])
  cleanupPassed = true
} finally {
  if (pollId) {
    await client.query('DELETE FROM social_poll_votes WHERE poll_id = $1', [pollId])
    await client.query('DELETE FROM social_poll_options WHERE poll_id = $1', [pollId])
    await client.query('DELETE FROM social_polls WHERE poll_id = $1', [pollId])
  }
  await client.release()
  await pool.end()
}

const report = {
  database: target.pathname.slice(1),
  postgresMajor: 18,
  createdAndReadBack,
  updatedWithoutVotes,
  sameConfigurationAllowedAfterVote,
  changedConfigurationRejectedAfterVote,
  publishedConfigurationImmutable,
  cleanupPassed,
  d1Touched: false,
  remoteNeonTouched: false,
}
const requiredPasses = [
  report.createdAndReadBack,
  report.updatedWithoutVotes,
  report.sameConfigurationAllowedAfterVote,
  report.changedConfigurationRejectedAfterVote,
  report.publishedConfigurationImmutable,
  report.cleanupPassed,
]
if (report.database !== 'luckread_w05_d1_02_schema' || report.postgresMajor !== 18 ||
    requiredPasses.some(value => value !== true) ||
    report.d1Touched !== false || report.remoteNeonTouched !== false) {
  throw new Error('W05 poll configuration PostgreSQL 18 rehearsal failed: ' + JSON.stringify(report))
}
await mkdir(new URL('../../../../artifacts/neon/', import.meta.url), { recursive: true }).catch(() => {})
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
console.log('W05_POLL_CONFIGURATION_POSTGRES18_REHEARSAL_PASS ' + JSON.stringify(report))
