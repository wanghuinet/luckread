import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import {
  buildMfaAuditEvent,
} from '../../src/auth/mfa-audit-events.js'
import {
  createMfaAuditOperationReceiptPostgres,
  finalizeMfaAuditOperationReceiptPostgres,
} from '../../src/neon/mfa-audit-operation-receipts-postgres.js'
import {
  reconcileMfaAuditOperationReceiptsPostgres,
} from '../../src/neon/mfa-audit-operation-receipt-reconciler-postgres.js'
import {
  recordMfaAuditEventOncePostgres,
} from '../../src/neon/mfa-audit-publication-journal-postgres.js'
import type { MfaAuditReceiptEvent } from '../../src/auth/mfa-audit-receipts.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-007 receipt reconciliation rehearsal outside disposable local luckread_schema PostgreSQL')
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
  'artifacts/neon/w02-auth007-mfa-receipt-reconciliation-postgres-runtime-rehearsal.json',
)
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const now = new Date().toISOString()
const userIds = {
  emitted: 'auth007-mfa-reconcile-emitted-' + suffix,
  stale: 'auth007-mfa-reconcile-stale-' + suffix,
  invalid: 'auth007-mfa-reconcile-invalid-' + suffix,
  legacy: 'auth007-mfa-reconcile-legacy-' + suffix,
  terminal: 'auth007-mfa-reconcile-terminal-' + suffix,
  retry: 'auth007-mfa-reconcile-retry-' + suffix,
  locked: 'auth007-mfa-reconcile-locked-' + suffix,
}
const receiptIds: string[] = []

const checks: Record<string, boolean> = {
  readyReceiptIsDurablyJournaledBeforeEmitted: false,
  staleStartedReceiptBecomesUnknown: false,
  emptyReadyPlanIsQuarantinedAsUnknown: false,
  legacyLockoutEventIdentityIsAdoptedBeforeEmission: false,
  previouslyFailedOutboxIsTerminalAndUnknown: false,
  transientWriteFailurePreservesCommittedJournalAndRetriesIdempotently: false,
  concurrentReconcilerSkipsLockedReceipt: false,
  syntheticReceiptsAndJournalRowsCleaned: false,
}

let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const createReceipt = async (
  userId: string,
  startedAt = now,
): Promise<string> => {
  const receiptId = await createMfaAuditOperationReceiptPostgres(pool, {
    userId,
    operationPath: '/two-factor/verify-totp',
    isChallenge: true,
    correlationId: 'req_auth007_reconcile_' + suffix,
    causationId: 'trace_auth007_reconcile_' + suffix,
    now: startedAt,
  })
  receiptIds.push(receiptId)
  return receiptId
}

const makeEvent = (
  _userId: string,
  idempotencyKey: string,
  overrides: Partial<MfaAuditReceiptEvent> = {},
): MfaAuditReceiptEvent => ({
  eventType: 'auth.mfa.challenge_succeeded',
  operationId: 'authMfaChallengeVerify',
  result: 'succeeded',
  reasonCode: 'CHALLENGE_VERIFIED',
  challengeMethod: 'totp',
  occurredAt: now,
  idempotencyKey,
  ...overrides,
})

const makeReadyReceipt = async (
  userId: string,
  event: MfaAuditReceiptEvent,
): Promise<string> => {
  const receiptId = await createReceipt(userId)
  await finalizeMfaAuditOperationReceiptPostgres(pool, receiptId, [event], now)
  return receiptId
}

const readReceipt = async (receiptId: string) => {
  const result = await pool.query<{
    status: string
    resourceId: string
    eventPlan: string | null
    attempt: number
    nextAttemptAt: Date | null
    lastErrorCode: string | null
  }>(
    'SELECT status, resource_id AS "resourceId", event_plan AS "eventPlan", attempt, ' +
      'next_attempt_at AS "nextAttemptAt", last_error_code AS "lastErrorCode" ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [receiptId],
  )
  assert.equal(result.rowCount, 1, 'expected exactly one AUTH-007 MFA receipt')
  return result.rows[0]!
}

const readJournal = async (idempotencyKey: string) => {
  const result = await pool.query<{
    eventId: string
    eventType: string
    resourceId: string
    status: string
    payload: string
  }>(
    'SELECT event_id AS "eventId", event_type AS "eventType", resource_id AS "resourceId", status, payload ' +
      'FROM auth_007_mfa_publication_journal WHERE idempotency_key = $1',
    [idempotencyKey],
  )
  return result.rows[0] ?? null
}

const insertJournal = async (
  input: Parameters<typeof buildMfaAuditEvent>[0],
  status: 'PENDING' | 'PUBLISHED' | 'FAILED',
): Promise<string> => {
  const event = buildMfaAuditEvent(input)
  await pool.query(
    'INSERT INTO auth_007_mfa_publication_journal ' +
      '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
      'idempotency_key, payload, status, attempt, next_attempt_at, created_at, published_at, last_error_code) ' +
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NULL, $10, NULL, NULL)',
    [
      'auth007-mfa-reconcile-journal-' + randomUUID().replaceAll('-', ''),
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

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  const [receiptBefore, journalBefore] = await Promise.all([
    pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_operation_receipts',
    ),
    pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_publication_journal',
    ),
  ])
  assert.equal(Number(receiptBefore.rows[0]?.count), 0, 'receipt table must be empty before rehearsal')
  assert.equal(Number(journalBefore.rows[0]?.count), 0, 'MFA publication journal must be empty before rehearsal')

  const emittedKey = 'mfa-operation:reconcile:' + suffix + ':emitted'
  const emittedReceipt = await makeReadyReceipt(
    userIds.emitted,
    makeEvent(userIds.emitted, emittedKey),
  )
  const emittedSummary = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
  assert.deepEqual(emittedSummary, { selected: 1, emitted: 1, failed: 0, unknown: 0 })
  const emittedRow = await readReceipt(emittedReceipt)
  const emittedJournal = await readJournal(emittedKey)
  assert.equal(emittedRow.status, 'EMITTED')
  assert.equal(emittedJournal?.resourceId, userIds.emitted)
  assert.equal(emittedJournal?.status, 'PENDING')
  assert.equal(JSON.parse(emittedJournal?.payload ?? '{}').eventId, emittedJournal?.eventId)
  checks.readyReceiptIsDurablyJournaledBeforeEmitted = true

  const staleStart = new Date(Date.parse(now) - 6 * 60 * 1000).toISOString()
  const staleReceipt = await createReceipt(userIds.stale, staleStart)
  const staleSummary = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
  assert.deepEqual(staleSummary, { selected: 0, emitted: 0, failed: 0, unknown: 1 })
  const staleRow = await readReceipt(staleReceipt)
  assert.equal(staleRow.status, 'UNKNOWN')
  assert.equal(staleRow.lastErrorCode, 'OUTCOME_NOT_FINALIZED')
  assert.equal(staleRow.nextAttemptAt, null)
  checks.staleStartedReceiptBecomesUnknown = true

  const invalidReceipt = await createReceipt(userIds.invalid)
  await pool.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'READY', event_plan = '[]' WHERE receipt_id = $1",
    [invalidReceipt],
  )
  const invalidSummary = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
  assert.deepEqual(invalidSummary, { selected: 1, emitted: 0, failed: 0, unknown: 1 })
  const invalidRow = await readReceipt(invalidReceipt)
  assert.equal(invalidRow.status, 'UNKNOWN')
  assert.equal(invalidRow.lastErrorCode, 'INVALID_EVENT_PLAN')
  checks.emptyReadyPlanIsQuarantinedAsUnknown = true

  const legacyKey = 'mfa-lock:' + userIds.legacy + ':window:1'
  const legacyInput = {
    eventType: 'auth.mfa.locked' as const,
    operationId: 'authMfaChallengeVerify',
    userId: userIds.legacy,
    occurredAt: now,
    correlationId: 'req_auth007_reconcile_' + suffix,
    causationId: 'trace_auth007_reconcile_' + suffix,
    result: 'rejected' as const,
    reasonCode: 'TOO_MANY_FAILED_ATTEMPTS',
    challengeMethod: 'totp' as const,
    idempotencyKey: legacyKey,
  }
  const legacyEventId = await insertJournal(legacyInput, 'PENDING')
  const planEventId = 'evt_' + randomUUID().replaceAll('-', '')
  const legacyReceipt = await makeReadyReceipt(
    userIds.legacy,
    makeEvent(userIds.legacy, legacyKey, {
      eventType: 'auth.mfa.locked',
      operationId: 'authMfaChallengeVerify',
      result: 'rejected',
      reasonCode: 'TOO_MANY_FAILED_ATTEMPTS',
      challengeMethod: 'recovery_code',
      eventId: planEventId,
    }),
  )
  const legacySummary = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
  assert.deepEqual(legacySummary, { selected: 1, emitted: 1, failed: 0, unknown: 0 })
  const legacyRow = await readReceipt(legacyReceipt)
  const legacyPlan = JSON.parse(legacyRow.eventPlan ?? '[]') as Array<{ eventId: string; idempotencyKey: string }>
  assert.equal(legacyRow.status, 'EMITTED')
  assert.equal(legacyPlan.length, 1)
  assert.equal(legacyPlan[0]?.idempotencyKey, legacyKey)
  assert.equal(legacyPlan[0]?.eventId, legacyEventId)
  assert.notEqual(legacyPlan[0]?.eventId, planEventId)
  assert.equal((await readJournal(legacyKey))?.eventId, legacyEventId)
  checks.legacyLockoutEventIdentityIsAdoptedBeforeEmission = true

  const terminalKey = 'mfa-operation:reconcile:' + suffix + ':failed'
  const terminalEventId = 'evt_' + randomUUID().replaceAll('-', '')
  const terminalInput = {
    eventId: terminalEventId,
    eventType: 'auth.mfa.challenge_succeeded' as const,
    operationId: 'authMfaChallengeVerify',
    userId: userIds.terminal,
    occurredAt: now,
    correlationId: 'req_auth007_reconcile_' + suffix,
    causationId: 'trace_auth007_reconcile_' + suffix,
    result: 'succeeded' as const,
    reasonCode: 'CHALLENGE_VERIFIED',
    challengeMethod: 'totp' as const,
    idempotencyKey: terminalKey,
  }
  await insertJournal(terminalInput, 'FAILED')
  const terminalReceipt = await makeReadyReceipt(
    userIds.terminal,
    makeEvent(userIds.terminal, terminalKey, { eventId: terminalEventId }),
  )
  const terminalSummary = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
  assert.deepEqual(terminalSummary, { selected: 1, emitted: 0, failed: 0, unknown: 1 })
  const terminalRow = await readReceipt(terminalReceipt)
  assert.equal(terminalRow.status, 'UNKNOWN')
  assert.equal(terminalRow.lastErrorCode, 'OUTBOX_PREVIOUSLY_FAILED')
  checks.previouslyFailedOutboxIsTerminalAndUnknown = true

  const retryKeyA = 'mfa-operation:reconcile:' + suffix + ':retry-a'
  const retryKeyB = 'mfa-operation:reconcile:' + suffix + ':retry-b'
  const retryReceipt = await createReceipt(userIds.retry)
  await finalizeMfaAuditOperationReceiptPostgres(pool, retryReceipt, [
    makeEvent(userIds.retry, retryKeyA, { reasonCode: 'RETRY_TEST_A' }),
    makeEvent(userIds.retry, retryKeyB, { reasonCode: 'RETRY_TEST_B' }),
  ], now)
  let journalWriteCount = 0
  const transientFailureReconciler = async (
    database: Pool,
    input: Parameters<typeof recordMfaAuditEventOncePostgres>[1],
  ) => {
    journalWriteCount += 1
    if (journalWriteCount === 2) {
      throw new Error('synthetic temporary PostgreSQL write failure')
    }
    return recordMfaAuditEventOncePostgres(database, input)
  }
  const retryFailure = await reconcileMfaAuditOperationReceiptsPostgres(
    pool,
    now,
    1,
    transientFailureReconciler,
  )
  assert.deepEqual(retryFailure, { selected: 1, emitted: 0, failed: 1, unknown: 0 })
  const retryingRow = await readReceipt(retryReceipt)
  assert.equal(retryingRow.status, 'READY')
  assert.equal(Number(retryingRow.attempt), 1)
  assert.equal(
    new Date(retryingRow.nextAttemptAt as Date).toISOString(),
    new Date(Date.parse(now) + 1_000).toISOString(),
  )
  assert.equal(retryingRow.lastErrorCode, 'OUTBOX_WRITE_FAILED')
  const persistedBeforeRetry = await readJournal(retryKeyA)
  assert.equal(persistedBeforeRetry?.status, 'PENDING',
    'an earlier successful outbox event remains durable after a later event fails')
  assert.equal(await readJournal(retryKeyB), null,
    'the failed event must remain absent until the retry succeeds')
  const retrySuccess = await reconcileMfaAuditOperationReceiptsPostgres(
    pool,
    new Date(Date.parse(now) + 2_000).toISOString(),
    1,
  )
  assert.deepEqual(retrySuccess, { selected: 1, emitted: 1, failed: 0, unknown: 0 })
  assert.equal((await readReceipt(retryReceipt)).status, 'EMITTED')
  assert.equal((await readJournal(retryKeyA))?.status, 'PENDING')
  assert.equal((await readJournal(retryKeyB))?.status, 'PENDING')
  checks.transientWriteFailureRollsBackPartialJournalAndRetriesAtomically = true

  const lockedKey = 'mfa-operation:reconcile:' + suffix + ':locked'
  const lockedReceipt = await makeReadyReceipt(
    userIds.locked,
    makeEvent(userIds.locked, lockedKey),
  )
  const lockClient = await pool.connect()
  let lockTransactionOpen = false
  try {
    await lockClient.query('BEGIN')
    lockTransactionOpen = true
    const locked = await lockClient.query(
      'SELECT receipt_id FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1 FOR UPDATE',
      [lockedReceipt],
    )
    assert.equal(locked.rowCount, 1)
    const skipped = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
    assert.deepEqual(skipped, { selected: 0, emitted: 0, failed: 0, unknown: 0 })
  } finally {
    try {
      if (lockTransactionOpen) await lockClient.query('ROLLBACK')
    } finally {
      lockClient.release()
    }
  }
  const afterLock = await reconcileMfaAuditOperationReceiptsPostgres(pool, now, 1)
  assert.deepEqual(afterLock, { selected: 1, emitted: 1, failed: 0, unknown: 0 })
  assert.equal((await readReceipt(lockedReceipt)).status, 'EMITTED')
  checks.concurrentReconcilerSkipsLockedReceipt = true
} catch (error) {
  primaryError = error
} finally {
  try {
    const resources = Object.values(userIds)
    if (receiptIds.length > 0) {
      await pool.query(
        'DELETE FROM auth_007_mfa_operation_receipts WHERE receipt_id = ANY($1::text[])',
        [receiptIds],
      )
    }
    await pool.query(
      'DELETE FROM auth_007_mfa_publication_journal WHERE resource_id = ANY($1::text[])',
      [resources],
    )
    const [receiptResidual, journalResidual] = await Promise.all([
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_operation_receipts WHERE receipt_id = ANY($1::text[])',
        [receiptIds],
      ),
      pool.query<{ count: number }>(
        'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_publication_journal WHERE resource_id = ANY($1::text[])',
        [resources],
      ),
    ])
    cleanupVerified =
      Number(receiptResidual.rows[0]?.count ?? -1) === 0 &&
      Number(journalResidual.rows[0]?.count ?? -1) === 0
    checks.syntheticReceiptsAndJournalRowsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic MFA receipts and journal rows must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure
    ? 'W02_AUTH007_MFA_RECEIPT_RECONCILIATION_POSTGRES_RUNTIME_REHEARSAL_FAILED'
    : 'W02_AUTH007_MFA_RECEIPT_RECONCILIATION_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-007 MFA receipt reconciliation against disposable PostgreSQL 18; production W02 remains on D1-01.',
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
  console.error('W02_AUTH007_MFA_RECEIPT_RECONCILIATION_POSTGRES_RUNTIME_REHEARSAL_FAILED ' + report.error)
  process.exitCode = 1
} else {
  console.log('W02_AUTH007_MFA_RECEIPT_RECONCILIATION_POSTGRES_RUNTIME_REHEARSAL_PASS ' + JSON.stringify(report))
}
