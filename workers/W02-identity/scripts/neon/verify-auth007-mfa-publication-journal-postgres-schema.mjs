import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { resolveExpectedSchemaDatabase } from './verify-schema-database-target.mjs'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')
const expectedDatabase = resolveExpectedSchemaDatabase()

const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const journalPrefix = 'auth007-mfa-journal-' + suffix + '-'
const resourceId = 'auth007-mfa-user-' + suffix
const actorId = resourceId
const createdAt = new Date('2026-01-01T00:00:00.000Z')
const nextAttemptAt = new Date('2026-01-01T00:00:02.000Z')
const publishedAt = new Date('2026-01-01T00:00:03.000Z')

const eventTypes = [
  'auth.mfa.enrollment_started',
  'auth.mfa.enrollment_verified',
  'auth.mfa.enrollment_failed',
  'auth.mfa.challenge_succeeded',
  'auth.mfa.challenge_failed',
  'auth.mfa.factor_disabled',
  'auth.mfa.recovery_codes_rotated',
  'auth.mfa.recovery_code_consumed',
  'auth.mfa.locked',
  'auth.mfa.replay_rejected',
]
const operationIds = [
  'authMfaEnrollmentStart',
  'authMfaEnrollmentConfirm',
  'authMfaEnrollmentStart',
  'authMfaChallengeVerify',
  'authMfaChallengeVerify',
  'authMfaDisable',
  'authMfaRecoveryCodesRotate',
  'authMfaChallengeVerify',
  'authMfaChallengeVerify',
  'authMfaChallengeVerify',
]

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH007_MFA_JOURNAL_PG_ASSERTION_FAILED: ' + message)
}
const expectPgCode = async (client, label, operation, expectedCode) => {
  const savepoint = 'mfa_journal_negative_' + randomUUID().replaceAll('-', '').slice(0, 12)
  await client.query('SAVEPOINT ' + savepoint)
  try {
    await operation()
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT ' + savepoint)
    await client.query('RELEASE SAVEPOINT ' + savepoint)
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  await client.query('ROLLBACK TO SAVEPOINT ' + savepoint)
  await client.query('RELEASE SAVEPOINT ' + savepoint)
  throw new Error('W02_AUTH007_MFA_JOURNAL_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}

function makeEntry(eventType, operationId, index, overrides = {}) {
  const eventId = 'evt_' + randomUUID().replaceAll('-', '')
  const idempotencyKey = 'mfa-journal-' + suffix + '-' + String(index).padStart(2, '0')
  const event = {
    eventId,
    eventType,
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId,
    occurredAt: createdAt.toISOString(),
    publishedAt: createdAt.toISOString(),
    correlationId: 'mfa-correlation-' + suffix,
    causationId: 'mfa-causation-' + suffix,
    idempotencyKey,
    attempt: 1,
    sourceVersion: 1,
    actor: { actorId, actorType: 'user' },
    payload: { operationId, result: 'succeeded' },
  }
  return {
    journalId: journalPrefix + String(index),
    eventId,
    eventType,
    schemaVersion: '1.0',
    resourceId,
    sourceVersion: 1,
    idempotencyKey,
    payload: JSON.stringify(event),
    createdAt,
    ...overrides,
  }
}

const insertColumns = [
  'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
  'source_version', 'idempotency_key', 'payload', 'status', 'attempt',
  'next_attempt_at', 'created_at', 'published_at', 'last_error_code',
]
const insertSql = 'INSERT INTO auth_007_mfa_publication_journal (' + insertColumns.join(', ') + ') ' +
  'VALUES (' + insertColumns.map((_, index) => '$' + (index + 1)).join(', ') + ')'
const insertEntry = (client, entry) => client.query(insertSql, [
  entry.journalId, entry.eventId, entry.eventType, entry.schemaVersion, entry.resourceId,
  entry.sourceVersion, entry.idempotencyKey, entry.payload,
  entry.status ?? 'PENDING', entry.attempt ?? 1, entry.nextAttemptAt ?? null,
  entry.createdAt, entry.publishedAt ?? null, entry.lastErrorCode ?? null,
])
const insertWithDefaults = (client, entry) => client.query(
  'INSERT INTO auth_007_mfa_publication_journal ' +
    '(journal_id, event_id, event_type, schema_version, resource_id, source_version, idempotency_key, payload, created_at) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
  [
    entry.journalId, entry.eventId, entry.eventType, entry.schemaVersion, entry.resourceId,
    entry.sourceVersion, entry.idempotencyKey, entry.payload, entry.createdAt,
  ],
)

let client
let transactionOpen = false
let primaryError
let report
try {
  client = await pool.connect()
  const identity = await client.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === expectedDatabase, 'unexpected database target')

  const before = await client.query(
    "SELECT COUNT(*)::int AS count FROM auth_007_mfa_publication_journal",
  )
  assert(Number(before.rows[0].count) === 0, 'MFA publication journal must be empty before synthetic probe')

  const columns = await client.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'auth_007_mfa_publication_journal'",
  )
  const columnMap = new Map(columns.rows.map((row) => [row.column_name, row]))
  const expectedColumns = [
    'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
    'source_version', 'idempotency_key', 'payload', 'status', 'attempt',
    'next_attempt_at', 'created_at', 'published_at', 'last_error_code',
  ].sort()
  assert(JSON.stringify([...columnMap.keys()].sort()) === JSON.stringify(expectedColumns),
    'journal must have exactly fourteen contract columns')
  for (const name of [
    'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
    'idempotency_key', 'payload', 'status',
  ]) {
    assert(columnMap.get(name)?.data_type === 'text' && columnMap.get(name)?.is_nullable === 'NO',
      name + ' must use TEXT NOT NULL')
  }
  assert(columnMap.get('source_version')?.data_type === 'integer' &&
    columnMap.get('source_version')?.is_nullable === 'NO',
  'source_version must use INTEGER NOT NULL')
  assert(columnMap.get('attempt')?.data_type === 'integer' &&
    columnMap.get('attempt')?.is_nullable === 'NO' &&
    columnMap.get('attempt')?.column_default === '1',
  'attempt must use INTEGER NOT NULL DEFAULT 1')
  assert(columnMap.get('created_at')?.data_type === 'timestamp with time zone' &&
    columnMap.get('created_at')?.is_nullable === 'NO',
  'created_at must use TIMESTAMPTZ NOT NULL')
  for (const name of ['next_attempt_at', 'published_at']) {
    assert(columnMap.get(name)?.data_type === 'timestamp with time zone' &&
      columnMap.get(name)?.is_nullable === 'YES', name + ' must use nullable TIMESTAMPTZ')
  }
  assert(columnMap.get('last_error_code')?.data_type === 'text' &&
    columnMap.get('last_error_code')?.is_nullable === 'YES',
  'last_error_code must use nullable TEXT')
  assert(columnMap.get('status')?.column_default?.includes('PENDING'),
    'status must default to PENDING')

  const indexes = await client.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' " +
      "AND tablename = 'auth_007_mfa_publication_journal'",
  )
  const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
  for (const name of [
    'auth_007_mfa_publication_journal_pkey',
    'auth_007_mfa_publication_journal_event_id_uq',
    'auth_007_mfa_publication_journal_idempotency_key_uq',
    'auth_007_mfa_publication_journal_status_next_attempt_idx',
  ]) assert(indexMap.has(name), 'required MFA outbox index missing: ' + name)
  assert(indexMap.get('auth_007_mfa_publication_journal_status_next_attempt_idx')?.includes('(status, next_attempt_at)'),
    'MFA journal retry index columns mismatch')

  const constraints = await client.query(
    "SELECT conname, contype, pg_get_constraintdef(oid) AS definition " +
      "FROM pg_constraint WHERE conrelid = 'auth_007_mfa_publication_journal'::regclass",
  )
  const constraintMap = new Map(constraints.rows.map((row) => [row.conname, row]))
  for (const name of [
    'auth_007_mfa_publication_journal_pkey',
    'auth_007_mfa_publication_journal_event_id_uq',
    'auth_007_mfa_publication_journal_idempotency_key_uq',
    'auth_007_mfa_publication_journal_event_type_check',
    'auth_007_mfa_publication_journal_schema_version_check',
    'auth_007_mfa_publication_journal_source_version_check',
    'auth_007_mfa_publication_journal_payload_check',
    'auth_007_mfa_publication_journal_status_check',
    'auth_007_mfa_publication_journal_attempt_check',
    'auth_007_mfa_publication_journal_last_error_code_check',
  ]) assert(constraintMap.has(name), 'required MFA journal constraint missing: ' + name)
  const foreignKeys = constraints.rows.filter((row) => row.contype === 'f')
  assert(foreignKeys.length === 0, 'MFA outbox must not create a factor or canonical AuditEvent foreign key')

  // Use one rollback-only transaction for the synthetic event rows and SAVEPOINT-based negative probes.
  await client.query('BEGIN')
  transactionOpen = true

  // Every event type in the binding contract must be insertable with its permitted safe payload.
  const insertedEntries = []
  for (let i = 0; i < eventTypes.length; i++) {
    const entry = makeEntry(eventTypes[i], operationIds[i], i)
    const result = await insertWithDefaults(client, entry)
    assert(result.rowCount === 1, 'canonical event type must be accepted: ' + eventTypes[i])
    insertedEntries.push(entry)
  }
  const first = insertedEntries[0]
  const defaultRow = await client.query(
    'SELECT status, attempt, next_attempt_at, published_at, last_error_code, payload ' +
      'FROM auth_007_mfa_publication_journal WHERE journal_id = $1',
    [first.journalId],
  )
  assert(defaultRow.rows[0].status === 'PENDING', 'status default must be PENDING')
  assert(Number(defaultRow.rows[0].attempt) === 1, 'attempt default must be 1')
  assert(defaultRow.rows[0].next_attempt_at === null &&
    defaultRow.rows[0].published_at === null &&
    defaultRow.rows[0].last_error_code === null,
  'retry/publication fields must default NULL')
  assert(defaultRow.rows[0].payload === first.payload, 'safe event payload must be preserved byte-for-byte')
  const parsedPayload = JSON.parse(defaultRow.rows[0].payload)
  const payloadKeys = Object.keys(parsedPayload.payload).sort()
  assert(JSON.stringify(payloadKeys) === JSON.stringify(['operationId', 'result']),
    'sample event payload must contain only canonical allowed fields')
  for (const forbidden of [
    'secret', 'totpUri', 'code', 'backupCodes', 'recoveryCode',
    'sessionToken', 'cookie', 'lastAcceptedTotpTimeStep',
    'mfaEnrollmentKeyHash', 'mfaEnrollmentConfirmKeyHash',
  ]) {
    assert(!JSON.stringify(parsedPayload).toLowerCase().includes(forbidden.toLowerCase()),
      'sample event must not contain forbidden secret key: ' + forbidden)
  }

  await expectPgCode(client, 'invalid event type', () => insertEntry(client, {
    ...makeEntry('auth.mfa.unknown', operationIds[0], 20),
  }), '23514')
  await expectPgCode(client, 'invalid schema version', () => insertEntry(client, {
    ...makeEntry(eventTypes[0], operationIds[0], 21, { schemaVersion: '2.0' }),
  }), '23514')
  await expectPgCode(client, 'zero source version', () => insertEntry(client, {
    ...makeEntry(eventTypes[0], operationIds[0], 22, { sourceVersion: 0 }),
  }), '23514')
  await expectPgCode(client, 'invalid status', () => insertEntry(client, {
    ...makeEntry(eventTypes[0], operationIds[0], 23, { status: 'RETRYING' }),
  }), '23514')
  await expectPgCode(client, 'zero attempt', () => insertEntry(client, {
    ...makeEntry(eventTypes[0], operationIds[0], 24, { attempt: 0 }),
  }), '23514')
  await expectPgCode(client, 'overlong last error code', () => insertEntry(client, {
    ...makeEntry(eventTypes[0], operationIds[0], 25, { lastErrorCode: 'x'.repeat(129) }),
  }), '23514')
  await expectPgCode(client, 'duplicate event id', () => insertEntry(client, {
    ...makeEntry(eventTypes[1], operationIds[1], 26, { eventId: first.eventId }),
  }), '23505')
  await expectPgCode(client, 'duplicate idempotency key', () => insertEntry(client, {
    ...makeEntry(eventTypes[1], operationIds[1], 27, { idempotencyKey: first.idempotencyKey }),
  }), '23505')
  await expectPgCode(client, 'malformed JSON payload', () => insertEntry(client, {
    ...makeEntry(eventTypes[1], operationIds[1], 28, { payload: '{invalid-json' }),
  }), '22P02')
  await expectPgCode(client, 'non-object JSON payload', () => insertEntry(client, {
    ...makeEntry(eventTypes[1], operationIds[1], 29, { payload: '[]' }),
  }), '23514')

  // The schema permits independent immutable events for the same User/resource.
  const sameResourceDifferentEvent = makeEntry(eventTypes[1], operationIds[1], 30)
  assert((await insertEntry(client, sameResourceDifferentEvent)).rowCount === 1,
    'different event identities for one resource must be allowed')

  const concurrent = await Promise.allSettled([
    pool.query(insertSql, [
      journalPrefix + 'concurrent-a',
      'evt_' + randomUUID().replaceAll('-', ''),
      eventTypes[0], '1.0', resourceId, 1, 'mfa-concurrent-' + suffix,
      JSON.stringify({ eventType: eventTypes[0], payload: { operationId: operationIds[0], result: 'succeeded' } }),
      'PENDING', 1, null, createdAt, null, null,
    ]),
    pool.query(insertSql, [
      journalPrefix + 'concurrent-b',
      'evt_' + randomUUID().replaceAll('-', ''),
      eventTypes[0], '1.0', resourceId, 1, 'mfa-concurrent-' + suffix,
      JSON.stringify({ eventType: eventTypes[0], payload: { operationId: operationIds[0], result: 'succeeded' } }),
      'PENDING', 1, null, createdAt, null, null,
    ]),
  ])
  const winners = concurrent.filter((result) => result.status === 'fulfilled').length
  const conflicts = concurrent.filter((result) => result.status === 'rejected' && result.reason?.code === '23505').length
  assert(winners === 1 && conflicts === 1,
    'concurrent duplicate idempotency key must have exactly one winner')

  const beforeRetry = await client.query(
    'SELECT event_id, event_type, idempotency_key, source_version, payload ' +
      'FROM auth_007_mfa_publication_journal WHERE journal_id = $1',
    [first.journalId],
  )
  await client.query(
    "UPDATE auth_007_mfa_publication_journal SET status = 'PENDING', attempt = attempt + 1, " +
      'next_attempt_at = $1, last_error_code = $2 WHERE journal_id = $3',
    [nextAttemptAt, 'QUEUE_DESTINATION_FAILED', first.journalId],
  )
  const afterRetry = await client.query(
    'SELECT event_id, event_type, idempotency_key, source_version, payload, status, attempt, last_error_code ' +
      'FROM auth_007_mfa_publication_journal WHERE journal_id = $1',
    [first.journalId],
  )
  for (const key of ['event_id', 'event_type', 'idempotency_key', 'source_version', 'payload']) {
    assert(afterRetry.rows[0][key] === beforeRetry.rows[0][key],
      'retry must retain immutable publication intent field: ' + key)
  }
  assert(afterRetry.rows[0].status === 'PENDING' && Number(afterRetry.rows[0].attempt) === 2,
    'retryable Queue failure must keep PENDING and increment attempt')
  assert(afterRetry.rows[0].last_error_code === 'QUEUE_DESTINATION_FAILED',
    'retry error code must be persisted')

  await client.query(
    "UPDATE auth_007_mfa_publication_journal SET status = 'PUBLISHED', published_at = $1, " +
      'next_attempt_at = NULL, last_error_code = NULL WHERE journal_id = $2',
    [publishedAt, first.journalId],
  )
  const published = await client.query(
    'SELECT status, published_at, next_attempt_at, last_error_code ' +
      'FROM auth_007_mfa_publication_journal WHERE journal_id = $1',
    [first.journalId],
  )
  assert(published.rows[0].status === 'PUBLISHED' &&
    published.rows[0].published_at instanceof Date,
  'Queue accepted publication must persist PUBLISHED and native timestamp')
  assert(published.rows[0].next_attempt_at === null && published.rows[0].last_error_code === null,
    'successful Queue acceptance must clear retry state')

  const retryRows = await client.query(
    "SELECT COUNT(*)::int AS count FROM auth_007_mfa_publication_journal " +
      "WHERE status = 'PENDING' AND next_attempt_at IS NOT NULL AND attempt > 1",
  )
  assert(Number(retryRows.rows[0].count) === 0,
    'successful publication must leave no pending retry row for the acknowledged event')

  report = {
    status: 'W02_AUTH007_MFA_PUBLICATION_JOURNAL_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    checks: {
      exactFourteenColumnContract: true,
      nativePostgresTemporalTypes: true,
      allTenCanonicalEventTypesAccepted: true,
      fixedSchemaVersionAndPositiveSourceVersion: true,
      eventIdUniqueness: true,
      idempotencyKeyUniqueness: true,
      concurrentIdempotencySingleWinner: true,
      payloadIsValidJsonObject: true,
      malformedAndNonObjectPayloadRejected: true,
      samplePayloadUsesOnlySafeCanonicalFields: true,
      statusAndAttemptDefaultsAndConstraints: true,
      retryPreservesImmutableEventIdentity: true,
      retryableQueueFailureRemainsPending: true,
      acceptedQueuePublicationSetsPublishedAt: true,
      noForeignKeysOrCanonicalAuditRowsInvented: true,
    },
    verifiedCheckCount: 15,
    tableRows: { auth_007_mfa_publication_journal: 0 },
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
  try {
    await pool.query(
      'DELETE FROM auth_007_mfa_publication_journal WHERE journal_id LIKE $1 OR idempotency_key LIKE $2 OR resource_id = $3',
      [journalPrefix + '%', 'mfa-journal-' + suffix + '-%', resourceId],
    )
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }
  try {
    const remaining = await pool.query(
      "SELECT COUNT(*)::int AS count FROM auth_007_mfa_publication_journal",
    )
    if (Number(remaining.rows[0].count) !== 0) {
      if (!primaryError) primaryError = new Error('W02_AUTH007_MFA_JOURNAL_POSTFLIGHT_ROWS_NOT_EMPTY')
    } else if (!primaryError && report) {
      report.checks.syntheticJournalRowsCleaned = true
      report.verifiedCheckCount = Object.keys(report.checks).length
    }
  } catch (cleanupVerificationError) {
    if (!primaryError) primaryError = cleanupVerificationError
  }
  if (client) client.release()
  await pool.end()
}

if (primaryError) throw primaryError
if (!report || report.checks.syntheticJournalRowsCleaned !== true) {
  throw new Error('W02_AUTH007_MFA_JOURNAL_POSTFLIGHT_EVIDENCE_INCOMPLETE')
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
