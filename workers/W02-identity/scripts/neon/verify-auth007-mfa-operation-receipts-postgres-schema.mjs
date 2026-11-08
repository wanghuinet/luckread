import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const receiptPrefix = 'auth007-mfa-receipt-' + suffix + '-'
const resourceId = 'auth007-mfa-user-' + suffix
const startedAt = new Date('2026-01-01T00:00:00.000Z')
const completedAt = new Date('2026-01-01T00:01:00.000Z')
const nextAttemptAt = new Date('2026-01-01T00:01:02.000Z')
const operationPaths = [
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
]
const statuses = ['STARTED', 'READY', 'EMITTED', 'RESOLVED', 'UNKNOWN']

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH007_MFA_RECEIPT_PG_ASSERTION_FAILED: ' + message)
}
let client
let transactionOpen = false
let negativeProbeSequence = 0
let primaryError
let report
const expectPgCode = async (label, run, expectedCode) => {
  const savepoint = 'mfa_receipt_negative_' + (++negativeProbeSequence)
  await client.query('SAVEPOINT ' + savepoint)
  try {
    await run()
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT ' + savepoint)
    await client.query('RELEASE SAVEPOINT ' + savepoint)
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  await client.query('ROLLBACK TO SAVEPOINT ' + savepoint)
  await client.query('RELEASE SAVEPOINT ' + savepoint)
  throw new Error('W02_AUTH007_MFA_RECEIPT_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}
const insertReceipt = async (overrides = {}) => client.query(
  'INSERT INTO auth_007_mfa_operation_receipts (' +
    'receipt_id, resource_id, operation_path, is_challenge, status, started_at, completed_at, ' +
    'correlation_id, causation_id, event_plan, attempt, next_attempt_at, last_error_code' +
  ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
  [
    overrides.receiptId ?? receiptPrefix + randomUUID().replaceAll('-', ''),
    overrides.resourceId ?? resourceId,
    overrides.operationPath ?? operationPaths[0],
    overrides.isChallenge ?? 0,
    overrides.status ?? 'STARTED',
    overrides.startedAt ?? startedAt,
    overrides.completedAt ?? null,
    overrides.correlationId ?? 'mfa-receipt-correlation-' + suffix,
    overrides.causationId ?? 'mfa-receipt-causation-' + suffix,
    overrides.eventPlan ?? null,
    overrides.attempt ?? 0,
    overrides.nextAttemptAt ?? null,
    overrides.lastErrorCode ?? null,
  ],
)

try {
  client = await pool.connect()
  const identity = await client.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === 'luckread_schema', 'unexpected database target')
  const before = await client.query('SELECT COUNT(*)::int AS count FROM auth_007_mfa_operation_receipts')
  assert(Number(before.rows[0].count) === 0, 'MFA operation receipts must be empty before synthetic probe')

  const columns = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'auth_007_mfa_operation_receipts'",
  )
  const columnMap = new Map(columns.rows.map((row) => [row.column_name, row]))
  const expectedColumns = [
    'receipt_id', 'resource_id', 'operation_path', 'is_challenge', 'status',
    'started_at', 'completed_at', 'correlation_id', 'causation_id', 'event_plan',
    'attempt', 'next_attempt_at', 'last_error_code',
  ].sort()
  assert(JSON.stringify([...columnMap.keys()].sort()) === JSON.stringify(expectedColumns),
    'receipt table must have exactly thirteen contract columns')
  for (const name of [
    'receipt_id', 'resource_id', 'operation_path', 'status', 'correlation_id',
    'causation_id', 'event_plan', 'last_error_code',
  ]) assert(columnMap.get(name)?.data_type === 'text', name + ' must use TEXT')
  for (const name of [
    'receipt_id', 'resource_id', 'operation_path', 'is_challenge', 'status',
    'started_at', 'correlation_id', 'causation_id', 'attempt',
  ]) assert(columnMap.get(name)?.is_nullable === 'NO', name + ' must be NOT NULL')
  for (const name of ['completed_at', 'event_plan', 'next_attempt_at', 'last_error_code']) {
    assert(columnMap.get(name)?.is_nullable === 'YES', name + ' must remain nullable')
  }
  assert(columnMap.get('is_challenge')?.column_default === null,
    'is_challenge must have no default; W02 supplies it explicitly')
  assert(columnMap.get('attempt')?.column_default === '0',
    'attempt must default to zero')
  assert(columnMap.get('is_challenge')?.data_type === 'integer' &&
    columnMap.get('is_challenge')?.is_nullable === 'NO',
  'is_challenge must remain INTEGER NOT NULL')
  assert(columnMap.get('attempt')?.data_type === 'integer' &&
    columnMap.get('attempt')?.is_nullable === 'NO' &&
    columnMap.get('attempt')?.column_default === '0',
  'attempt must use INTEGER NOT NULL DEFAULT 0')
  for (const name of ['started_at']) {
    assert(columnMap.get(name)?.data_type === 'timestamp with time zone' &&
      columnMap.get(name)?.is_nullable === 'NO', name + ' must use TIMESTAMPTZ NOT NULL')
  }
  for (const name of ['completed_at', 'next_attempt_at']) {
    assert(columnMap.get(name)?.data_type === 'timestamp with time zone' &&
      columnMap.get(name)?.is_nullable === 'YES', name + ' must use nullable TIMESTAMPTZ')
  }
  assert(columnMap.get('status')?.column_default?.includes('STARTED'),
    'status must default to STARTED')

  const indexes = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' " +
      "AND tablename = 'auth_007_mfa_operation_receipts'",
  )
  const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
  assert(indexMap.has('auth_007_mfa_operation_receipts_pkey'), 'receipt primary key missing')
  assert(indexMap.has('auth_007_mfa_operation_receipts_status_next_attempt_idx'),
    'receipt retry index missing')
  assert(indexMap.get('auth_007_mfa_operation_receipts_status_next_attempt_idx')?.includes('(status, next_attempt_at, started_at)'),
    'receipt retry index column order mismatch')

  const constraints = await client.query(
    "SELECT conname, contype FROM pg_constraint " +
      "WHERE conrelid = 'auth_007_mfa_operation_receipts'::regclass",
  )
  const constraintMap = new Map(constraints.rows.map((row) => [row.conname, row]))
  for (const name of [
    'auth_007_mfa_operation_receipts_pkey',
    'auth_007_mfa_operation_receipts_operation_path_check',
    'auth_007_mfa_operation_receipts_is_challenge_check',
    'auth_007_mfa_operation_receipts_status_check',
    'auth_007_mfa_operation_receipts_correlation_id_check',
    'auth_007_mfa_operation_receipts_causation_id_check',
    'auth_007_mfa_operation_receipts_event_plan_check',
    'auth_007_mfa_operation_receipts_attempt_check',
    'auth_007_mfa_operation_receipts_last_error_code_check',
  ]) assert(constraintMap.has(name), 'required receipt constraint missing: ' + name)
  assert(constraints.rows.filter((row) => row.contype === 'f').length === 0,
    'receipt records must not introduce factor, session or canonical audit foreign keys')

  await client.query('BEGIN')
  transactionOpen = true
  // Each operation path and receipt state in the contract is accepted.
  for (let i = 0; i < operationPaths.length; i++) {
    await insertReceipt({
      receiptId: receiptPrefix + 'path-' + i,
      operationPath: operationPaths[i],
      isChallenge: i < 2 ? 1 : 0,
    })
  }
  for (let i = 0; i < statuses.length; i++) {
    await insertReceipt({
      receiptId: receiptPrefix + 'status-' + i,
      operationPath: operationPaths[0],
      status: statuses[i],
    })
  }

  const defaultReceiptId = receiptPrefix + 'default-started'
  await insertReceipt({ receiptId: defaultReceiptId })
  const defaultRow = await client.query(
    'SELECT status, is_challenge, started_at, completed_at, event_plan, attempt, next_attempt_at, last_error_code ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [defaultReceiptId],
  )
  assert(defaultRow.rows[0].status === 'STARTED', 'new operation receipt must default STARTED')
  assert(Number(defaultRow.rows[0].is_challenge) === 0, 'non-challenge receipt must preserve integer zero')
  assert(Number(defaultRow.rows[0].attempt) === 0, 'new receipt attempt must default zero')
  assert(defaultRow.rows[0].started_at instanceof Date, 'started_at must round-trip as TIMESTAMPTZ')
  assert(defaultRow.rows[0].completed_at === null && defaultRow.rows[0].event_plan === null &&
    defaultRow.rows[0].next_attempt_at === null && defaultRow.rows[0].last_error_code === null,
  'new receipt nullable fields must default NULL')

  const safePlan = [{
    eventType: 'auth.mfa.enrollment_started',
    operationId: 'authMfaEnrollmentStart',
    eventId: 'evt_' + randomUUID().replaceAll('-', ''),
    idempotencyKey: 'mfa-operation:' + suffix + ':auth.mfa.enrollment_started',
    occurredAt: startedAt.toISOString(),
    result: 'started',
  }]
  const serializedPlan = JSON.stringify(safePlan)
  await client.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'READY', event_plan = $1, " +
      'completed_at = $2 WHERE receipt_id = $3',
    [serializedPlan, completedAt, defaultReceiptId],
  )
  const ready = await client.query(
    'SELECT status, event_plan, completed_at FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [defaultReceiptId],
  )
  assert(ready.rows[0].status === 'READY' && ready.rows[0].event_plan === serializedPlan &&
    ready.rows[0].completed_at instanceof Date,
  'READY receipt must durably store a valid event plan and completion timestamp')
  const planValue = JSON.parse(ready.rows[0].event_plan)
  assert(Array.isArray(planValue) && planValue.length === 1 &&
    JSON.stringify(Object.keys(planValue[0]).sort()) === JSON.stringify([
      'eventId', 'eventType', 'idempotencyKey', 'occurredAt', 'operationId', 'result',
    ]),
  'receipt event plan sample must contain only safe event identity and outcome fields')

  // A retryable outbox write failure leaves READY visible and increments attempt.
  await client.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'READY', attempt = attempt + 1, " +
      'next_attempt_at = $1, last_error_code = $2 WHERE receipt_id = $3',
    [nextAttemptAt, 'OUTBOX_WRITE_FAILED', defaultReceiptId],
  )
  const retried = await client.query(
    'SELECT status, event_plan, attempt, next_attempt_at, last_error_code ' +
      'FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [defaultReceiptId],
  )
  assert(retried.rows[0].status === 'READY' && retried.rows[0].event_plan === serializedPlan &&
    Number(retried.rows[0].attempt) === 1 && retried.rows[0].next_attempt_at instanceof Date &&
    retried.rows[0].last_error_code === 'OUTBOX_WRITE_FAILED',
  'retryable outbox failure must retain READY event plan and increase attempt')

  // The state vocabulary represents EMITTED and RESOLVED without making this schema the final audit authority.
  await client.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'EMITTED', next_attempt_at = NULL, last_error_code = NULL WHERE receipt_id = $1",
    [defaultReceiptId],
  )
  const emitted = await client.query(
    'SELECT status, event_plan FROM auth_007_mfa_operation_receipts WHERE receipt_id = $1',
    [defaultReceiptId],
  )
  assert(emitted.rows[0].status === 'EMITTED' && emitted.rows[0].event_plan === serializedPlan,
    'EMITTED receipt must preserve its immutable event plan')
  await client.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'UNKNOWN', last_error_code = $1 WHERE receipt_id = $2",
    ['OUTCOME_NOT_FINALIZED', receiptPrefix + 'status-0'],
  )
  await client.query(
    "UPDATE auth_007_mfa_operation_receipts SET status = 'RESOLVED', completed_at = $1 WHERE receipt_id = $2",
    [completedAt, receiptPrefix + 'status-1'],
  )
  const terminal = await client.query(
    "SELECT COUNT(*)::int AS count FROM auth_007_mfa_operation_receipts WHERE receipt_id IN ($1, $2) AND status IN ('UNKNOWN', 'RESOLVED')",
    [receiptPrefix + 'status-0', receiptPrefix + 'status-1'],
  )
  assert(Number(terminal.rows[0].count) === 2,
    'UNKNOWN and RESOLVED terminal receipt outcomes must be representable')

  await expectPgCode('invalid operation path', () => insertReceipt({
    receiptId: receiptPrefix + 'invalid-path',
    operationPath: '/two-factor/enroll',
  }), '23514')
  await expectPgCode('invalid is_challenge flag', () => insertReceipt({
    receiptId: receiptPrefix + 'invalid-challenge',
    isChallenge: 2,
  }), '23514')
  await expectPgCode('invalid receipt status', () => insertReceipt({
    receiptId: receiptPrefix + 'invalid-status',
    status: 'RETRYING',
  }), '23514')
  await expectPgCode('negative attempt', () => insertReceipt({
    receiptId: receiptPrefix + 'negative-attempt',
    attempt: -1,
  }), '23514')
  await expectPgCode('overlong correlation ID', () => insertReceipt({
    receiptId: receiptPrefix + 'long-correlation',
    correlationId: 'x'.repeat(129),
  }), '23514')
  await expectPgCode('overlong causation ID', () => insertReceipt({
    receiptId: receiptPrefix + 'long-causation',
    causationId: 'x'.repeat(129),
  }), '23514')
  await expectPgCode('overlong error code', () => insertReceipt({
    receiptId: receiptPrefix + 'long-error',
    lastErrorCode: 'x'.repeat(129),
  }), '23514')
  await expectPgCode('malformed event plan JSON', () => insertReceipt({
    receiptId: receiptPrefix + 'bad-json',
    eventPlan: '{invalid-json',
  }), '22P02')
  await expectPgCode('non-array event plan JSON', () => insertReceipt({
    receiptId: receiptPrefix + 'non-array',
    eventPlan: '{}',
  }), '23514')

  report = {
    status: 'W02_AUTH007_MFA_OPERATION_RECEIPTS_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    checks: {
      exactThirteenColumnContract: true,
      nativePostgresTemporalTypes: true,
      integerChallengeFlagAndDefaultAttempt: true,
      allFourOperationPathsAccepted: true,
      allFiveReceiptStatusesRepresentable: true,
      readyEventPlanValidJsonArray: true,
      safeEventPlanFieldsOnly: true,
      retryFailureKeepsReadyAndIncrementsAttempt: true,
      emittedResolvedUnknownOutcomesRepresentable: true,
      receiptCorrelationAndErrorLengthConstraints: true,
      invalidPathsAndChallengeFlagsRejected: true,
      malformedAndNonArrayEventPlansRejected: true,
      noForeignKeysOrNewAuthorityRowsInvented: true,
      syntheticReceiptsRolledBack: true,
    },
    tableRows: { auth_007_mfa_operation_receipts: 0 },
    productionDatabaseTouched: false,
    secretsOrAuditEventsImported: false,
  }
  await client.query('ROLLBACK')
  transactionOpen = false
} catch (error) {
  primaryError = error
} finally {
  if (client && transactionOpen) {
    try {
      await client.query('ROLLBACK')
      transactionOpen = false
    } catch (rollbackError) {
      if (!primaryError) primaryError = rollbackError
    }
  }
  if (client) client.release()
  await pool.end()
}

if (primaryError) throw primaryError
if (!report) throw new Error('W02_AUTH007_MFA_RECEIPTS_POSTFLIGHT_EVIDENCE_INCOMPLETE')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
