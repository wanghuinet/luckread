import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { buildMfaAuditEvent } from '../../src/auth/mfa-audit-events.js'
import { publishPendingMfaAuditEventsPostgres } from '../../src/neon/mfa-audit-publication-journal-publisher-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-007 publisher rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({
  connectionString,
  max: 8,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
})

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workerRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(workerRoot, 'artifacts/neon/w02-auth007-mfa-publication-publisher-postgres-runtime-rehearsal.json')
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const now = new Date().toISOString()
const resourceIds = {
  success: 'auth007-pub-success-' + suffix,
  retry: 'auth007-pub-retry-' + suffix,
  invalid: 'auth007-pub-invalid-' + suffix,
  maxBackoff: 'auth007-pub-backoff-' + suffix,
  concurrent: 'auth007-pub-concurrent-' + suffix,
}
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const makeEvent = (resourceId: string, eventTag: string) =>
  buildMfaAuditEvent({
    eventId: 'evt_' + randomUUID().replaceAll('-', '').slice(0, 32),
    eventType: 'auth.mfa.challenge_succeeded',
    operationId: 'authMfaChallengeVerify',
    userId: resourceId,
    occurredAt: eventTag === 'success' ? now.replace(/Z$/, '+00:00') : now,
    correlationId: 'corr_auth007_pub_' + eventTag + '_' + suffix,
    causationId: 'cause_auth007_pub_' + eventTag + '_' + suffix,
    result: 'succeeded',
    challengeMethod: 'totp',
    idempotencyKey: 'auth007-publisher:' + eventTag + ':' + suffix,
  })

const insertJournal = async (input: {
  event: ReturnType<typeof buildMfaAuditEvent>
  payload?: string
  attempt?: number
}): Promise<void> => {
  const event = input.event
  await pool.query(
    'INSERT INTO auth_007_mfa_publication_journal ' +
      '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
      'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'PENDING', $9, NULL, $10, NULL, NULL)",
    [
      'auth007-publisher-journal-' + randomUUID().replaceAll('-', ''),
      event.eventId,
      event.eventType,
      event.schemaVersion,
      event.resourceId,
      event.sourceVersion,
      event.idempotencyKey,
      input.payload ?? JSON.stringify(event),
      input.attempt ?? 1,
      event.publishedAt,
    ],
  )
}

const readJournal = async (resourceId: string) => {
  const result = await pool.query<{
    status: string
    attempt: number
    nextAttemptAt: Date | string | null
    publishedAt: Date | string | null
    lastErrorCode: string | null
  }>(
    'SELECT status, attempt, next_attempt_at AS "nextAttemptAt", ' +
      'published_at AS "publishedAt", last_error_code AS "lastErrorCode" ' +
      'FROM auth_007_mfa_publication_journal WHERE resource_id = $1',
    [resourceId],
  )
  assert.equal(result.rows.length, 1, 'expected exactly one AUTH-007 journal row')
  return result.rows[0]!
}

const checks: Record<string, boolean> = {
  validMfaEventSentToExistingQueueAndMarkedPublished: false,
  queueFailureUsesBoundedBackoffAndPreservesPendingState: false,
  maximumBackoffIsCappedAtFiveMinutes: false,
  secretBearingOrMalformedPayloadIsQuarantined: false,
  concurrentPublisherRunsDoNotDoubleSendLockedRow: false,
  syntheticJournalRowsCleaned: false,
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  const successEvent = makeEvent(resourceIds.success, 'success')
  await insertJournal({ event: successEvent })
  const delivered: unknown[] = []
  const successQueue = { send: async (message: unknown) => { delivered.push(message) } }
  const success = await publishPendingMfaAuditEventsPostgres(pool, successQueue, now, 1)
  assert.deepEqual(success, { selected: 1, published: 1, failed: 0 })
  assert.deepEqual(delivered, [successEvent])
  const publishedRow = await readJournal(resourceIds.success)
  assert.equal(publishedRow.status, 'PUBLISHED')
  assert.equal(Number(publishedRow.attempt), 1)
  assert.equal(publishedRow.nextAttemptAt, null)
  assert.ok(publishedRow.publishedAt)
  assert.equal(publishedRow.lastErrorCode, null)
  checks.validMfaEventSentToExistingQueueAndMarkedPublished = true

  const retryEvent = makeEvent(resourceIds.retry, 'retry')
  await insertJournal({ event: retryEvent, attempt: 3 })
  const unavailableQueue = { send: async () => { throw new Error('synthetic queue failure') } }
  const retry = await publishPendingMfaAuditEventsPostgres(pool, unavailableQueue, now, 1)
  assert.deepEqual(retry, { selected: 1, published: 0, failed: 1 })
  const retryRow = await readJournal(resourceIds.retry)
  assert.equal(retryRow.status, 'PENDING')
  assert.equal(Number(retryRow.attempt), 4)
  assert.equal(new Date(retryRow.nextAttemptAt as Date | string).toISOString(),
    new Date(Date.parse(now) + 4_000).toISOString())
  assert.equal(retryRow.lastErrorCode, 'QUEUE_DESTINATION_FAILED')
  assert.equal(retryRow.publishedAt, null)
  checks.queueFailureUsesBoundedBackoffAndPreservesPendingState = true

  const backoffEvent = makeEvent(resourceIds.maxBackoff, 'max-backoff')
  await insertJournal({ event: backoffEvent, attempt: 12 })
  const backoff = await publishPendingMfaAuditEventsPostgres(
    pool,
    { send: async () => { throw new Error('synthetic queue failure') } },
    now,
    1,
  )
  assert.deepEqual(backoff, { selected: 1, published: 0, failed: 1 })
  const backoffRow = await readJournal(resourceIds.maxBackoff)
  assert.equal(Number(backoffRow.attempt), 13)
  assert.equal(new Date(backoffRow.nextAttemptAt as Date | string).toISOString(),
    new Date(Date.parse(now) + 300_000).toISOString())
  checks.maximumBackoffIsCappedAtFiveMinutes = true

  const invalidEvent = makeEvent(resourceIds.invalid, 'invalid')
  const secretBearingPayload = {
    ...invalidEvent,
    payload: { ...invalidEvent.payload, recoveryCode: 'synthetic-secret-must-never-be-published' },
  }
  await insertJournal({ event: invalidEvent, payload: JSON.stringify(secretBearingPayload) })
  let invalidSendCount = 0
  const invalid = await publishPendingMfaAuditEventsPostgres(
    pool,
    { send: async () => { invalidSendCount += 1 } },
    now,
    1,
  )
  assert.deepEqual(invalid, { selected: 1, published: 0, failed: 1 })
  assert.equal(invalidSendCount, 0)
  const invalidRow = await readJournal(resourceIds.invalid)
  assert.equal(invalidRow.status, 'FAILED')
  assert.equal(invalidRow.nextAttemptAt, null)
  assert.equal(invalidRow.lastErrorCode, 'INVALID_EVENT_PAYLOAD')
  checks.secretBearingOrMalformedPayloadIsQuarantined = true

  const concurrentEvent = makeEvent(resourceIds.concurrent, 'concurrent')
  await insertJournal({ event: concurrentEvent })
  let concurrentSends = 0
  const concurrentQueue = {
    send: async () => {
      concurrentSends += 1
      await new Promise((resolve) => setTimeout(resolve, 150))
    },
  }
  const concurrent = await Promise.all([
    publishPendingMfaAuditEventsPostgres(pool, concurrentQueue, now, 1),
    publishPendingMfaAuditEventsPostgres(pool, concurrentQueue, now, 1),
  ])
  assert.equal(concurrentSends, 1)
  assert.equal(concurrent.reduce((total, item) => total + item.selected, 0), 1)
  assert.equal(concurrent.reduce((total, item) => total + item.published, 0), 1)
  assert.equal((await readJournal(resourceIds.concurrent)).status, 'PUBLISHED')
  checks.concurrentPublisherRunsDoNotDoubleSendLockedRow = true
} catch (error) {
  primaryError = error
} finally {
  try {
    const resources = Object.values(resourceIds)
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
    assert.equal(cleanupVerified, true, 'all synthetic AUTH-007 journal rows must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure ? 'W02_AUTH007_MFA_PUBLICATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_FAILED' :
    'W02_AUTH007_MFA_PUBLICATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-007 PostgreSQL journal publisher against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  assertionsPassed: Object.values(checks).filter(Boolean).length,
  cleanupVerified,
  existingAuth013QueueBindingChanged: false,
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
  console.error('W02_AUTH007_MFA_PUBLICATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_FAILED ' + report.error)
  process.exitCode = 1
} else {
  console.log('W02_AUTH007_MFA_PUBLICATION_PUBLISHER_POSTGRES_RUNTIME_REHEARSAL_PASS ' + JSON.stringify(report))
}
