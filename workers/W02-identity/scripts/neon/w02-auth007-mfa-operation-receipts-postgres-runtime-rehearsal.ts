import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import {
  appendMfaAuditOperationReceiptEventPostgres,
  assertMfaAuditOperationReceiptOwnerPostgres,
  createMfaAuditOperationReceiptPostgres,
  finalizeMfaAuditOperationReceiptPostgres,
} from '../../src/neon/mfa-audit-operation-receipts-postgres.js'
import type { MfaAuditReceiptEvent } from '../../src/auth/mfa-audit-receipts.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')

const target = new URL(connectionString)
const localDatabaseTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) &&
  target.port === '5432' &&
  target.pathname === '/luckread_schema'
if (!localDatabaseTarget) {
  throw new Error('Refusing AUTH-007 MFA receipt rehearsal outside disposable local luckread_schema PostgreSQL')
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
  'artifacts/neon/w02-auth007-mfa-operation-receipts-postgres-runtime-rehearsal.json',
)
const suffix = randomUUID().replaceAll('-', '').slice(0, 20).toLowerCase()
const now = new Date().toISOString()
const userId = 'auth007-mfa-receipt-user-' + suffix
const receiptIds: string[] = []
let primaryError: unknown
let cleanupError: unknown
let cleanupVerified = false

const createReceipt = async (
  operationPath: '/two-factor/verify-totp' | '/two-factor/verify-backup-code' |
    '/two-factor/disable' | '/two-factor/generate-backup-codes' = '/two-factor/verify-totp',
  isChallenge = true,
): Promise<string> => {
  const receiptId = await createMfaAuditOperationReceiptPostgres(pool, {
    userId,
    operationPath,
    isChallenge,
    correlationId: 'req_auth007_receipt_' + suffix,
    causationId: 'trace_auth007_receipt_' + suffix,
    now,
  })
  receiptIds.push(receiptId)
  return receiptId
}

const makeEvent = (
  idempotencyKey: string,
  overrides: Partial<MfaAuditReceiptEvent> = {},
): MfaAuditReceiptEvent => ({
  eventType: 'auth.mfa.challenge_succeeded',
  operationId: 'authMfaChallengeVerify',
  result: 'succeeded',
  reasonCode: 'CHALLENGE_VERIFIED',
  challengeMethod: 'totp',
  idempotencyKey,
  ...overrides,
})

const readReceipt = async (receiptId: string) => {
  const result = await pool.query<{
    status: string
    resourceId: string
    operationPath: string
    isChallenge: number
    eventPlan: string | null
    completedAt: Date | null
    attempt: number
  }>(
    'SELECT status, resource_id AS "resourceId", operation_path AS "operationPath", ' +
      'is_challenge AS "isChallenge", event_plan AS "eventPlan", ' +
      'completed_at AS "completedAt", attempt ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [receiptId],
  )
  assert.equal(result.rowCount, 1, 'expected exactly one AUTH-007 MFA receipt')
  return result.rows[0]!
}

const checks: Record<string, boolean> = {
  createdReceiptAndOwnershipContextValidated: false,
  appendsAreIdempotentAndRejectIntentConflicts: false,
  concurrentAppendsSerializeWithoutDuplicateEvents: false,
  finalizationIsImmutableAndResolvesEmptyPlans: false,
  fourEventPlanLimitIsEnforced: false,
  syntheticReceiptsCleaned: false,
}

try {
  const server = await pool.query(
    "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
  )
  assert.equal(server.rows[0]?.database_name, 'luckread_schema')
  assert.equal(Math.floor(Number(server.rows[0]?.version_num) / 10000), 18)

  const receiptId = await createReceipt()
  await assertMfaAuditOperationReceiptOwnerPostgres(pool, {
    receiptId,
    userId,
    operationPath: '/two-factor/verify-totp',
    isChallenge: true,
  })
  await assert.rejects(
    assertMfaAuditOperationReceiptOwnerPostgres(pool, {
      receiptId,
      userId: userId + '-other',
      operationPath: '/two-factor/verify-totp',
      isChallenge: true,
    }),
    /MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH/,
  )
  await assert.rejects(
    assertMfaAuditOperationReceiptOwnerPostgres(pool, {
      receiptId,
      userId,
      operationPath: '/two-factor/verify-backup-code',
      isChallenge: true,
    }),
    /MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH/,
  )
  await assert.rejects(
    assertMfaAuditOperationReceiptOwnerPostgres(pool, {
      receiptId,
      userId,
      operationPath: '/two-factor/verify-totp',
      isChallenge: false,
    }),
    /MFA_AUDIT_RECEIPT_CONTEXT_MISMATCH/,
  )
  const created = await readReceipt(receiptId)
  assert.equal(created.status, 'STARTED')
  assert.equal(created.resourceId, userId)
  assert.equal(created.isChallenge, 1)
  assert.equal(created.eventPlan, null)
  assert.equal(created.attempt, 0)
  checks.createdReceiptAndOwnershipContextValidated = true

  const eventKey = 'mfa-operation:' + receiptId + ':challenge'
  const event = makeEvent(eventKey)
  await appendMfaAuditOperationReceiptEventPostgres(pool, receiptId, event)
  await appendMfaAuditOperationReceiptEventPostgres(pool, receiptId, event)
  let row = await readReceipt(receiptId)
  let plan = JSON.parse(row.eventPlan ?? 'null') as Array<Record<string, unknown>>
  assert.equal(plan.length, 1, 'duplicate idempotency key must not append a second event')
  assert.equal(plan[0]?.idempotencyKey, eventKey)
  assert.equal(
    Object.keys(plan[0] ?? {}).sort().join(','),
    ['challengeMethod', 'eventId', 'eventType', 'idempotencyKey', 'occurredAt', 'operationId', 'reasonCode', 'result'].sort().join(','),
  )
  assert.doesNotMatch(row.eventPlan ?? '', /password|totpCode|backupCode|recoveryCode|cookie|sessionToken|secret/i)
  await assert.rejects(
    appendMfaAuditOperationReceiptEventPostgres(pool, receiptId, makeEvent(eventKey, {
      result: 'failed',
      reasonCode: 'CHALLENGE_REJECTED',
    })),
    /MFA_AUDIT_EVENT_IDEMPOTENCY_CONFLICT/,
  )
  row = await readReceipt(receiptId)
  plan = JSON.parse(row.eventPlan ?? 'null') as Array<Record<string, unknown>>
  assert.equal(plan.length, 1, 'conflicting replay must not mutate the event plan')
  checks.appendsAreIdempotentAndRejectIntentConflicts = true

  const concurrentReceipt = await createReceipt()
  const concurrentEvent = makeEvent('mfa-operation:' + concurrentReceipt + ':concurrent')
  await Promise.all([
    appendMfaAuditOperationReceiptEventPostgres(pool, concurrentReceipt, concurrentEvent),
    appendMfaAuditOperationReceiptEventPostgres(pool, concurrentReceipt, concurrentEvent),
  ])
  const concurrentRow = await readReceipt(concurrentReceipt)
  assert.equal(JSON.parse(concurrentRow.eventPlan ?? '[]').length, 1)
  checks.concurrentAppendsSerializeWithoutDuplicateEvents = true

  const finalized = await finalizeMfaAuditOperationReceiptPostgres(pool, receiptId, [event], now)
  assert.equal(finalized, true)
  const retryFinalize = await finalizeMfaAuditOperationReceiptPostgres(pool, receiptId, [event], now)
  assert.equal(retryFinalize, false, 'same finalization retry must be idempotent')
  await assert.rejects(
    appendMfaAuditOperationReceiptEventPostgres(pool, receiptId, makeEvent(
      'mfa-operation:' + receiptId + ':late-event',
    )),
    /MFA_AUDIT_RECEIPT_NOT_APPENDABLE/,
  )
  row = await readReceipt(receiptId)
  assert.equal(row.status, 'READY')
  assert.ok(row.completedAt instanceof Date)

  const emptyReceipt = await createReceipt('/two-factor/disable', false)
  assert.equal(await finalizeMfaAuditOperationReceiptPostgres(pool, emptyReceipt, [], now), true)
  const resolved = await readReceipt(emptyReceipt)
  assert.equal(resolved.status, 'RESOLVED')
  assert.equal(resolved.eventPlan, '[]')
  assert.ok(resolved.completedAt instanceof Date)
  checks.finalizationIsImmutableAndResolvesEmptyPlans = true

  const boundedReceipt = await createReceipt()
  for (let index = 0; index < 4; index += 1) {
    await appendMfaAuditOperationReceiptEventPostgres(
      pool,
      boundedReceipt,
      makeEvent('mfa-operation:' + boundedReceipt + ':bounded-' + index, {
        reasonCode: 'TEST_EVENT_' + index,
      }),
    )
  }
  await assert.rejects(
    appendMfaAuditOperationReceiptEventPostgres(
      pool,
      boundedReceipt,
      makeEvent('mfa-operation:' + boundedReceipt + ':bounded-overflow', {
        reasonCode: 'TEST_EVENT_OVERFLOW',
      }),
    ),
    /MFA_AUDIT_RECEIPT_PLAN_LIMIT_EXCEEDED/,
  )
  const bounded = await readReceipt(boundedReceipt)
  assert.equal(JSON.parse(bounded.eventPlan ?? '[]').length, 4)
  checks.fourEventPlanLimitIsEnforced = true
} catch (error) {
  primaryError = error
} finally {
  try {
    if (receiptIds.length > 0) {
      await pool.query(
        'DELETE FROM auth_007_mfa_operation_receipts WHERE receipt_id = ANY($1::text[])',
        [receiptIds],
      )
      const residual = await pool.query<{ count: number }>(
        'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_operation_receipts WHERE receipt_id = ANY($1::text[])',
        [receiptIds],
      )
      cleanupVerified = Number(residual.rows[0]?.count ?? -1) === 0
    } else {
      cleanupVerified = true
    }
    checks.syntheticReceiptsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true, 'all synthetic MFA operation receipts must be removed')
  } catch (error) {
    cleanupError = error
  }
  await pool.end()
}

const failure = primaryError ?? cleanupError
const report = {
  reportVersion: 1,
  status: failure ? 'W02_AUTH007_MFA_OPERATION_RECEIPTS_POSTGRES_RUNTIME_REHEARSAL_FAILED' :
    'W02_AUTH007_MFA_OPERATION_RECEIPTS_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only AUTH-007 MFA operation receipt persistence against disposable PostgreSQL 18; production W02 remains on D1-01.',
  postgresMajor: 18,
  database: 'luckread_schema',
  checks,
  assertionsPassed: Object.values(checks).filter(Boolean).length,
  cleanupVerified,
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
  console.error('W02_AUTH007_MFA_OPERATION_RECEIPTS_POSTGRES_RUNTIME_REHEARSAL_FAILED ' + report.error)
  process.exitCode = 1
} else {
  console.log('W02_AUTH007_MFA_OPERATION_RECEIPTS_POSTGRES_RUNTIME_REHEARSAL_PASS ' + JSON.stringify(report))
}
