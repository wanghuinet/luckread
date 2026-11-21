import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import {
  createPostgresUsernameChangeStore,
} from '../../src/neon/username-change-postgres.js'
import type { UsernameChangeCommand } from '../../src/auth/username-change-store.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing W02 username-change rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const store = createPostgresUsernameChangeStore(pool)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(
  workerRoot,
  'artifacts/neon/w02-username-change-postgres-runtime-rehearsal.json',
)
const suffix = randomUUID().replaceAll('-', '').slice(0, 18).toLowerCase()
const userA = 'username-change-a-' + suffix
const userB = 'username-change-b-' + suffix
const userC = 'username-change-c-' + suffix
const identityA = 'username-change-identity-a-' + suffix
const identityB = 'username-change-identity-b-' + suffix
const identityC = 'username-change-identity-c-' + suffix
const now = new Date('2026-11-09T12:00:00.000Z')
const reservationExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
const idempotencyExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
const oldUsername = 'BeforeHandle'
const newUsername = 'AfterHandle'
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const hashC = 'c'.repeat(64)
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const checks: Record<string, boolean> = {
  postgresContextAndStateProjectionPreserveVersionsAndTimestamps: false,
  usernameAndCompactLeaseCommitAtomically: false,
  identityUsernameProjectionSynchronizesInTheSameTransaction: false,
  livePreviousUsernameLeaseCannotBeReclaimed: false,
  idempotencyReceiptCanBeReplayedFromTheStoredContext: false,
  concurrentSameVersionChangesHaveExactlyOneWinner: false,
  syntheticUsernameRowsAreRemoved: false,
}

function command(input: {
  userId: string
  currentUsername: string
  nextUsername: string
  expectedVersion: number
  idempotencyKeyHash: string
  requestFingerprint: string
}): UsernameChangeCommand {
  return {
    ...input,
    currentUsernameNormalized: input.currentUsername.toLowerCase(),
    nextUsernameNormalized: input.nextUsername.toLowerCase(),
    nowIso: now.toISOString(),
    reservationExpiresAt: reservationExpiresAt.toISOString(),
    idempotencyExpiresAt: idempotencyExpiresAt.toISOString(),
  }
}

async function createUser(
  userId: string,
  identityId: string,
  username: string,
): Promise<void> {
  await pool.query(
    'INSERT INTO "user" ' +
      '(id, name, email, email_verified, created_at, updated_at, username, account_state, account_state_version) ' +
      'VALUES ($1, $2, $3, TRUE, $4, $4, $5, \'ACTIVE\', 1)',
    [userId, 'Username change rehearsal', userId + '@example.invalid', now, username],
  )
  await pool.query(
    'INSERT INTO auth_identities (id, user_id, username, username_normalized, normalization_version) ' +
      'VALUES ($1, $2, $3, $4, $5)',
    [identityId, userId, username, username.toLowerCase(), 'unicode-nfc-casefold-v1'],
  )
}

async function removeUser(userId: string, identityId: string): Promise<void> {
  await pool.query(
    'DELETE FROM auth_credentials WHERE identity_id = $1',
    [identityId],
  )
  await pool.query(
    'DELETE FROM auth_username_change_state WHERE user_id = $1',
    [userId],
  )
  await pool.query(
    'DELETE FROM auth_identities WHERE id = $1',
    [identityId],
  )
  await pool.query('DELETE FROM "user" WHERE id = $1', [userId])
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  await createUser(userA, identityA, oldUsername)
  await createUser(userB, identityB, 'SecondHandle')
  await createUser(userC, identityC, 'ConcurrentOld')

  const initial = await store.loadContext(userA, hashA, now.toISOString())
  assert.deepEqual(initial, {
    username: oldUsername,
    accountState: 'ACTIVE',
    usernameVersion: 0,
    lastChangedAt: null,
    replayKeyHash: null,
    replayUsername: null,
    replayFingerprint: null,
    replayChangedAt: null,
    replayExpiresAt: null,
  })
  const initialState = await store.loadState(userA)
  assert.equal(initialState?.usernameVersion, 0)
  assert.equal(initialState?.lastChangedAt, null)
  checks.postgresContextAndStateProjectionPreserveVersionsAndTimestamps = true

  const firstCommand = command({
    userId: userA,
    currentUsername: oldUsername,
    nextUsername: newUsername,
    expectedVersion: 0,
    idempotencyKeyHash: hashA,
    requestFingerprint: 'd'.repeat(64),
  })
  const firstWrite = await store.applyChange(firstCommand)
  assert.deepEqual(firstWrite, { updated: 1, saved: 1 })

  const changed = await store.loadState(userA)
  assert.deepEqual(changed, {
    username: newUsername,
    accountState: 'ACTIVE',
    usernameVersion: 1,
    lastChangedAt: now.toISOString(),
  })
  const identityProjection = await pool.query<{
    username: string
    usernameNormalized: string
    normalizationVersion: string
  }>(
    'SELECT username, username_normalized AS "usernameNormalized", ' +
      'normalization_version AS "normalizationVersion" FROM auth_identities WHERE user_id = $1',
    [userA],
  )
  assert.deepEqual(identityProjection.rows[0], {
    username: newUsername,
    usernameNormalized: newUsername.toLowerCase(),
    normalizationVersion: 'unicode-nfc-casefold-v1',
  })
  checks.usernameAndCompactLeaseCommitAtomically = true
  checks.identityUsernameProjectionSynchronizesInTheSameTransaction = true

  const replay = await store.loadContext(userA, hashA, now.toISOString())
  assert.equal(replay?.replayKeyHash, hashA)
  assert.equal(replay?.replayUsername, newUsername)
  assert.equal(replay?.replayFingerprint, 'd'.repeat(64))
  assert.equal(replay?.replayChangedAt, now.toISOString())
  assert.equal(replay?.replayExpiresAt, idempotencyExpiresAt.toISOString())
  checks.idempotencyReceiptCanBeReplayedFromTheStoredContext = true

  const reservedAttempt = await store.applyChange(command({
    userId: userB,
    currentUsername: 'SecondHandle',
    nextUsername: oldUsername,
    expectedVersion: 0,
    idempotencyKeyHash: hashB,
    requestFingerprint: 'e'.repeat(64),
  }))
  assert.deepEqual(reservedAttempt, { updated: 0, saved: 0 })
  assert.equal((await store.loadState(userB))?.username, 'SecondHandle')
  checks.livePreviousUsernameLeaseCannotBeReclaimed = true

  const concurrentResults = await Promise.all([
    store.applyChange(command({
      userId: userC,
      currentUsername: 'ConcurrentOld',
      nextUsername: 'ConcurrentOne',
      expectedVersion: 0,
      idempotencyKeyHash: hashB,
      requestFingerprint: 'f'.repeat(64),
    })),
    store.applyChange(command({
      userId: userC,
      currentUsername: 'ConcurrentOld',
      nextUsername: 'ConcurrentTwo',
      expectedVersion: 0,
      idempotencyKeyHash: hashC,
      requestFingerprint: '1'.repeat(64),
    })),
  ])
  assert.equal(concurrentResults.filter(result => result.updated === 1 && result.saved === 1).length, 1)
  assert.equal(concurrentResults.filter(result => result.updated === 0 && result.saved === 0).length, 1)
  assert.equal((await store.loadState(userC))?.usernameVersion, 1)
  checks.concurrentSameVersionChangesHaveExactlyOneWinner = true
} catch (error) {
  primaryError = error
} finally {
  try {
    await removeUser(userC, identityC)
    await removeUser(userB, identityB)
    await removeUser(userA, identityA)
    const remaining = await pool.query<{ users: number; identities: number; states: number }>(
      'SELECT ' +
        '(SELECT COUNT(*)::integer FROM "user" WHERE id = ANY($1::text[])) AS users, ' +
        '(SELECT COUNT(*)::integer FROM auth_identities WHERE id = ANY($2::text[])) AS identities, ' +
        '(SELECT COUNT(*)::integer FROM auth_username_change_state WHERE user_id = ANY($1::text[])) AS states',
      [[userA, userB, userC], [identityA, identityB, identityC]],
    )
    cleanupVerified = Number(remaining.rows[0]?.users ?? -1) === 0 &&
      Number(remaining.rows[0]?.identities ?? -1) === 0 &&
      Number(remaining.rows[0]?.states ?? -1) === 0
    checks.syntheticUsernameRowsAreRemoved = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic W02 username rows must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure ? 'W02_USERNAME_CHANGE_POSTGRES_RUNTIME_REHEARSAL_FAILED' :
    'W02_USERNAME_CHANGE_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only W02 username-change PostgreSQL adapter against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  verifiedCheckCount: Object.values(checks).filter(Boolean).length,
  syntheticBusinessRowsRemaining: cleanupVerified ? 0 : null,
  productionDatabaseTouched: false,
  businessDataImported: false,
  runtimeBindingsChanged: false,
  productionCutoverAuthorized: false,
}

mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
if (failure) throw failure
assert.equal(Object.values(checks).every(Boolean), true, 'all W02 username-change PostgreSQL runtime checks must pass')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
