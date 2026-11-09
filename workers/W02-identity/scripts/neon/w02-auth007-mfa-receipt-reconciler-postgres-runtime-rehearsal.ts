import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Pool } from 'pg'

import { reconcileMfaAuditOperationReceiptsPostgres } from '../../src/neon/mfa-audit-operation-reconciler-postgres.js'

const connectionString = process.env.W02_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W02_RUNTIME_DATABASE_URL is required')
const target = new URL(connectionString)
if (!new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_schema') {
  throw new Error('Refusing AUTH-007 reconciler rehearsal outside disposable local luckread_schema PostgreSQL')
}
const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 20)
const now = new Date('2026-11-09T12:00:00.000Z')
const readyId = 'mfaop_' + randomUUID().replaceAll('-', '')
const staleId = 'mfaop_' + randomUUID().replaceAll('-', '')
const readyUser = 'auth007-reconcile-ready-' + suffix
const staleUser = 'auth007-reconcile-stale-' + suffix
const eventId = 'evt_' + randomUUID().replaceAll('-', '')
const idem = 'mfa-operation:' + readyId + ':auth.mfa.challenge_succeeded'
const eventPlan = [{
  eventType: 'auth.mfa.challenge_succeeded',
  operationId: 'authMfaChallengeVerify',
  eventId,
  result: 'succeeded',
  challengeMethod: 'totp',
  idempotencyKey: idem,
  occurredAt: now.toISOString(),
}]
const checks: Record<string, boolean> = {
  readyReceiptCreatesDurableJournalAndBecomesEmitted: false,
  concurrentReconciliationDoesNotDuplicateJournalRows: false,
  staleStartedReceiptBecomesUnknown: false,
  syntheticRowsCleaned: false,
}
let failure: unknown
let cleanupVerified = false
try {
  const info = await pool.query("SELECT current_database() AS db, current_setting('server_version_num')::integer AS version")
  assert.equal(info.rows[0]?.db, 'luckread_schema')
  assert.equal(Math.floor(Number(info.rows[0]?.version) / 10000), 18)
  const before = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_operation_receipts',
  )
  assert.equal(Number(before.rows[0]?.count), 0, 'receipt table must be empty before rehearsal')

  await pool.query(
    'INSERT INTO auth_007_mfa_operation_receipts ' +
      '(receipt_id, resource_id, operation_path, is_challenge, status, started_at, completed_at, ' +
      'correlation_id, causation_id, event_plan, attempt, next_attempt_at, last_error_code) ' +
      "VALUES ($1,$2,'/two-factor/verify-totp',1,'READY',$3,$3,$4,$5,$6,0,NULL,NULL), " +
      "($7,$8,'/two-factor/verify-totp',1,'STARTED',$9,NULL,$10,$11,NULL,0,NULL,NULL)",
    [readyId, readyUser, now, 'corr-' + suffix, 'cause-' + suffix, JSON.stringify(eventPlan),
      staleId, staleUser, new Date(now.getTime() - 6 * 60 * 1000), 'corr-stale-' + suffix, 'cause-stale-' + suffix],
  )

  const [first, second] = await Promise.all([
    reconcileMfaAuditOperationReceiptsPostgres(pool, now.toISOString()),
    reconcileMfaAuditOperationReceiptsPostgres(pool, now.toISOString()),
  ])
  const ready = await pool.query<{ status: string }>(
    'SELECT status FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1', [readyId],
  )
  assert.equal(ready.rows[0]?.status, 'EMITTED')
  const journal = await pool.query<{ count: number }>(
    'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_publication_journal WHERE idempotency_key = $1', [idem],
  )
  assert.equal(Number(journal.rows[0]?.count), 1)
  checks.readyReceiptCreatesDurableJournalAndBecomesEmitted = true
  assert.ok(first.emitted + second.emitted >= 1)
  checks.concurrentReconciliationDoesNotDuplicateJournalRows = true

  const stale = await pool.query<{ status: string; lastErrorCode: string }>(
    'SELECT status, last_error_code AS "lastErrorCode" FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [staleId],
  )
  assert.equal(stale.rows[0]?.status, 'UNKNOWN')
  assert.equal(stale.rows[0]?.lastErrorCode, 'OUTCOME_NOT_FINALIZED')
  checks.staleStartedReceiptBecomesUnknown = true
} catch (error) {
  failure = error
} finally {
  try {
    await pool.query('DELETE FROM auth_007_mfa_publication_journal WHERE resource_id = ANY($1::text[])', [[readyUser, staleUser]])
    await pool.query('DELETE FROM auth_007_mfa_operation_receipts WHERE receipt_id = ANY($1::text[])', [[readyId, staleId]])
    const remaining = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::integer AS count FROM auth_007_mfa_operation_receipts WHERE receipt_id = ANY($1::text[])',
      [[readyId, staleId]],
    )
    cleanupVerified = Number(remaining.rows[0]?.count) === 0
    checks.syntheticRowsCleaned = cleanupVerified
    assert.equal(cleanupVerified, true)
  } catch (error) {
    failure ??= error
  }
  await pool.end()
}
const report = {
  reportVersion: 1,
  status: failure ? 'W02_AUTH007_MFA_RECEIPT_RECONCILER_POSTGRES_RUNTIME_REHEARSAL_FAILED'
    : 'W02_AUTH007_MFA_RECEIPT_RECONCILER_POSTGRES_RUNTIME_REHEARSAL_PASS',
  scope: 'Test-only receipt reconciliation against disposable PostgreSQL 18; W02 production remains on D1-01.',
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
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const reportPath = path.resolve(scriptDir, '../../artifacts/neon/w02-auth007-mfa-receipt-reconciler-postgres-runtime-rehearsal.json')
mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
if (failure) {
  console.error(report.status + ' ' + report.error)
  process.exitCode = 1
} else {
  console.log(report.status + ' ' + JSON.stringify(report))
}
