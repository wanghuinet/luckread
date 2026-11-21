import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import {
  buildMfaAuditEvent,
  deriveMfaAuditEventIdForIdempotencyKey,
} from '../../src/auth/mfa-audit-events.js'
import { recordMfaAuditEventOncePostgres } from '../../src/neon/mfa-audit-publication-journal-postgres.js'

type RecordInput = Parameters<typeof recordMfaAuditEventOncePostgres>[1]

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-007 MFA journal rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(
  workerRoot,
  'artifacts/neon/w02-auth007-mfa-publication-journal-postgres-runtime-rehearsal.json',
)
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const now = new Date().toISOString()
const userIds = {
  primary: 'auth007-mfa-journal-primary-' + suffix,
  concurrent: 'auth007-mfa-journal-concurrent-' + suffix,
  legacy: 'auth007-mfa-journal-legacy-' + suffix,
  failed: 'auth007-mfa-journal-failed-' + suffix,
  collision: 'auth007-mfa-journal-collision-' + suffix,
}
const checks: Record<string, boolean> = {
  insertAndIdempotentReadbackPreserveCanonicalEvent: false,
  concurrentIdempotencyHasOneDurableWinner: false,
  conflictingIntentIsRejectedWithoutMutation: false,
  legacyLockoutIdentityIsAdopted: false,
  previouslyFailedJournalIsTerminal: false,
  eventIdCollisionIsRejected: false,
  syntheticJournalRowsCleaned: false,
}

let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const makeInput = (
  userId: string,
  idempotencyKey: string,
  overrides: Partial<RecordInput> = {},
): RecordInput => ({
  eventType: 'auth.mfa.challenge_succeeded',
  operationId: 'authMfaChallengeVerify',
  userId,
  occurredAt: now,
  correlationId: 'req_auth007_mfa_journal_' + suffix,
  causationId: 'trace_auth007_mfa_journal_' + suffix,
  result: 'succeeded',
  challengeMethod: 'totp',
  idempotencyKey,
  ...overrides,
})

const insertExisting = async (
  input: RecordInput,
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' = 'PENDING',
): Promise<string> => {
  const event = buildMfaAuditEvent(input)
  const journalId = 'auth007-mfa-journal-runtime-' + randomUUID().replaceAll('-', '')
  await pool.query(
    'INSERT INTO auth_007_mfa_publication_journal ' +
      '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
      'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NULL, $10, NULL, NULL)',
    [
      journalId,
      event.eventId,
      event.eventType,
      event.schemaVersion,
      event.resourceId,
      event.sourceVersion,
      event.idempotencyKey,
      JSON.stringify(event),
      status,
      new Date(event.publishedAt),
    ],
  )
  return event.eventId
}

const readByIdempotencyKey = async (idempotencyKey: string) => {
  const result = await pool.query<{
    journalId: string
    eventId: string
    eventType: string
    resourceId: string
    status: string
    attempt: number
    payload: string
  }>(
    'SELECT journal_id AS "journalId", event_id AS "eventId", event_type AS "eventType", ' +
      'resource_id AS "resourceId", status, attempt, payload ' +
      'FROM auth_007_mfa_publication_journal WHERE idempotency_key = $1',
    [idempotencyKey],
  )
  assert.equal(result.rowCount, 1, 'expected exactly one MFA publication journal row')
  return result.rows[0]!
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  const before = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_publication_journal',
  )
  assert.equal(Number(before.rows[0]?.count), 0, 'MFA publication journal must be empty before rehearsal')

  const primaryKey = 'mfa-operation:journal:' + suffix + ':primary'
  const primaryInput = makeInput(userIds.primary, primaryKey, {
    eventId: 'evt_' + randomUUID().replaceAll('-', ''),
  })
  const inserted = await recordMfaAuditEventOncePostgres(pool, primaryInput)
  assert.equal(inserted.inserted, true)
  const primaryRow = await readByIdempotencyKey(primaryKey)
  assert.equal(primaryRow.eventId, inserted.eventId)
  assert.equal(primaryRow.status, 'PENDING')
  assert.equal(Number(primaryRow.attempt), 1)
  const primaryPayload = JSON.parse(primaryRow.payload) as Record<string, unknown>
  assert.equal(primaryPayload.eventId, inserted.eventId)
  assert.equal(primaryPayload.producer, 'W02')
  assert.equal(primaryPayload.resourceId, userIds.primary)
  assert.equal(
    Object.keys(primaryPayload.payload as object).sort().join(','),
    ['challengeMethod', 'operationId', 'result'].sort().join(','),
  )
  assert.doesNotMatch(primaryRow.payload, /secret|totpUri|backupCodes|recoveryCode|sessionToken|cookie/i)

  const replay = await recordMfaAuditEventOncePostgres(pool, primaryInput)
  assert.deepEqual(replay, { inserted: false, eventId: inserted.eventId })
  assert.equal((await readByIdempotencyKey(primaryKey)).eventId, inserted.eventId)
  checks.insertAndIdempotentReadbackPreserveCanonicalEvent = true

  const concurrentKey = 'mfa-operation:journal:' + suffix + ':concurrent'
  const concurrentResults = await Promise.all(
    Array.from({ length: 6 }, () =>
      recordMfaAuditEventOncePostgres(pool, makeInput(userIds.concurrent, concurrentKey)),
    ),
  )
  assert.equal(concurrentResults.filter((result) => result.inserted).length, 1)
  assert.equal(new Set(concurrentResults.map((result) => result.eventId)).size, 1)
  const concurrentRow = await readByIdempotencyKey(concurrentKey)
  assert.equal(concurrentRow.status, 'PENDING')
  assert.equal(concurrentRow.resourceId, userIds.concurrent)
  checks.concurrentIdempotencyHasOneDurableWinner = true

  await assert.rejects(
    recordMfaAuditEventOncePostgres(
      pool,
      makeInput(userIds.primary, primaryKey, {
        result: 'failed',
        reasonCode: 'CHALLENGE_REJECTED',
      }),
    ),
    /MFA_AUDIT_EVENT_INTENT_CONFLICT/,
  )
  assert.equal((await readByIdempotencyKey(primaryKey)).eventId, inserted.eventId)
  checks.conflictingIntentIsRejectedWithoutMutation = true

  const lockoutKey = 'mfa-lock:' + userIds.legacy + ':window:1'
  const legacyInput = makeInput(userIds.legacy, lockoutKey, {
    eventType: 'auth.mfa.locked',
    result: 'rejected',
    reasonCode: 'TOO_MANY_FAILED_ATTEMPTS',
    challengeMethod: 'totp',
  })
  const legacyEventId = await insertExisting(legacyInput)
  const canonicalLockoutId = await deriveMfaAuditEventIdForIdempotencyKey(lockoutKey)
  assert.notEqual(legacyEventId, canonicalLockoutId)
  const adopted = await recordMfaAuditEventOncePostgres(pool, {
    ...legacyInput,
    eventId: canonicalLockoutId,
    challengeMethod: 'recovery_code',
  })
  assert.deepEqual(adopted, { inserted: false, eventId: legacyEventId })
  assert.equal((await readByIdempotencyKey(lockoutKey)).eventId, legacyEventId)
  checks.legacyLockoutIdentityIsAdopted = true

  const failedKey = 'mfa-operation:journal:' + suffix + ':failed'
  const failedInput = makeInput(userIds.failed, failedKey)
  await insertExisting(failedInput, 'FAILED')
  await assert.rejects(
    recordMfaAuditEventOncePostgres(pool, failedInput),
    /MFA_AUDIT_OUTBOX_PREVIOUSLY_FAILED/,
  )
  assert.equal((await readByIdempotencyKey(failedKey)).status, 'FAILED')
  checks.previouslyFailedJournalIsTerminal = true

  const collisionKey = 'mfa-operation:journal:' + suffix + ':collision'
  const collisionEventId = 'evt_' + randomUUID().replaceAll('-', '')
  await insertExisting(
    makeInput(userIds.collision, collisionKey + ':existing', { eventId: collisionEventId }),
  )
  await assert.rejects(
    recordMfaAuditEventOncePostgres(
      pool,
      makeInput(userIds.collision, collisionKey, { eventId: collisionEventId }),
    ),
    /MFA_AUDIT_EVENT_ID_CONFLICT/,
  )
  checks.eventIdCollisionIsRejected = true
} catch (error) {
  primaryError = error
} finally {
  try {
    const resources = Object.values(userIds)
    await pool.query(
      'DELETE FROM auth_007_mfa_publication_journal WHERE resource_id = ANY($1::text[])',
      [resources],
    )
    const residual = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_publication_journal WHERE resource_id = ANY($1::text[])',
      [resources],
    )
    cleanupVerified = Number(residual.rows[0]?.count ?? -1) === 0
    checks.syntheticJournalRowsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic MFA publication journal rows must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure
    ? 'W02_AUTH007_MFA_PUBLICATION_JOURNAL_POSTGRES_RUNTIME_REHEARSAL_FAILED'
    : 'W02_AUTH007_MFA_PUBLICATION_JOURNAL_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-007 MFA publication journal persistence against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  assertionsPassed: Object.values(checks).filter(Boolean).length,
  cleanupVerified,
  existingQueueBindingChanged: false,
  productionWorkerChanged: false,
  productionD1Touched: false,
  neonRemoteTouched: false,
  businessDataImported: false,
  productionCutoverAuthorized: false,
  error: failure instanceof Error ? failure.message.slice(0, 240) : null,
}
mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

if (failure) {
  console.error('W02_AUTH007_MFA_PUBLICATION_JOURNAL_POSTGRES_RUNTIME_REHEARSAL_FAILED ' + report.error)
  process.exitCode = 1
} else {
  console.log('W02_AUTH007_MFA_PUBLICATION_JOURNAL_POSTGRES_RUNTIME_REHEARSAL_PASS ' + JSON.stringify(report))
}
