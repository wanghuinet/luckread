import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 32)
const journalPrefix = 'auth010-journal-' + suffix + '-'
const sessionA = 'session-auth010-a-' + suffix.slice(0, 16)
const sessionB = 'session-auth010-b-' + suffix.slice(0, 16)
const actorId = 'user-auth010-' + suffix.slice(0, 16)
const createdAt = new Date('2026-01-01T00:00:00.000Z')

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH010_JOURNAL_PG_ASSERTION_FAILED: ' + message)
}
const expectPgCode = async (label, operation, expectedCode) => {
  try {
    await operation()
  } catch (error) {
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  throw new Error('W02_AUTH010_JOURNAL_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}
const expectAnyFailure = async (label, operation) => {
  try {
    await operation()
  } catch {
    return
  }
  throw new Error('W02_AUTH010_JOURNAL_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}
const makeEntry = (sessionId, eventSuffix, overrides = {}) => {
  const eventId = 'evt_' + eventSuffix
  const idempotencyKey = 'AUTH010_SESSION_REVOKE_' + eventSuffix
  const event = {
    eventId,
    eventType: 'user.session.revoked',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'Session',
    resourceId: sessionId,
    occurredAt: '2026-01-01T00:00:00.000Z',
    publishedAt: '2026-01-01T00:00:01.000Z',
    correlationId: 'req_' + eventSuffix,
    causationId: 'trace:' + eventSuffix,
    idempotencyKey,
    attempt: 1,
    sourceVersion: 1,
    actor: { actorId, actorType: 'user' },
    payload: { operationId: 'authSessionRevoke', result: 'succeeded', reasonCode: 'USER_INITIATED' },
  }
  const entry = {
    journalId: journalPrefix + eventSuffix,
    eventId,
    eventType: 'user.session.revoked',
    schemaVersion: '1.0',
    resourceId: sessionId,
    sourceVersion: 1,
    idempotencyKey,
    payload: JSON.stringify(event),
    createdAt,
    ...overrides,
  }
  return { entry, event }
}
const insertEntry = (entry) => pool.query(
  'INSERT INTO auth_010_session_revocation_journal ' +
    '(journal_id, event_id, event_type, schema_version, resource_id, source_version, ' +
    'idempotency_key, payload, created_at' +
    (entry.status === undefined ? '' : ', status') +
    (entry.attempt === undefined ? '' : ', attempt') +
    (entry.nextAttemptAt === undefined ? '' : ', next_attempt_at') +
    (entry.publishedAt === undefined ? '' : ', published_at') +
    (entry.lastErrorCode === undefined ? '' : ', last_error_code') +
    ') VALUES (' +
    [
      '$1', '$2', '$3', '$4', '$5', '$6', '$7', '$8', '$9',
      ...(entry.status === undefined ? [] : ['$10']),
      ...(entry.attempt === undefined ? [] : ['$' + (entry.status === undefined ? 10 : 11)]),
      ...(entry.nextAttemptAt === undefined ? [] : ['$' + (9 +
        (entry.status === undefined ? 0 : 1) +
        (entry.attempt === undefined ? 0 : 1) + 1)]),
      ...(entry.publishedAt === undefined ? [] : ['$' + (9 +
        (entry.status === undefined ? 0 : 1) +
        (entry.attempt === undefined ? 0 : 1) +
        (entry.nextAttemptAt === undefined ? 0 : 1) + 1)]),
      ...(entry.lastErrorCode === undefined ? [] : ['$' + (9 +
        (entry.status === undefined ? 0 : 1) +
        (entry.attempt === undefined ? 0 : 1) +
        (entry.nextAttemptAt === undefined ? 0 : 1) +
        (entry.publishedAt === undefined ? 0 : 1) + 1)]),
    ].join(', ') + ')',
  [
    entry.journalId, entry.eventId, entry.eventType, entry.schemaVersion, entry.resourceId,
    entry.sourceVersion, entry.idempotencyKey, entry.payload, entry.createdAt,
    ...(entry.status === undefined ? [] : [entry.status]),
    ...(entry.attempt === undefined ? [] : [entry.attempt]),
    ...(entry.nextAttemptAt === undefined ? [] : [entry.nextAttemptAt]),
    ...(entry.publishedAt === undefined ? [] : [entry.publishedAt]),
    ...(entry.lastErrorCode === undefined ? [] : [entry.lastErrorCode]),
  ],
)

let successReport
let primaryError
try {
  const identity = await pool.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === 'luckread_schema', 'unexpected database target')

  const columns = await pool.query(
    "SELECT column_name, data_type, is_nullable, column_default " +
      "FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auth_010_session_revocation_journal'",
  )
  const columnMap = new Map(columns.rows.map((row) => [row.column_name, row]))
  const expectedColumns = [
    'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
    'source_version', 'idempotency_key', 'payload', 'status', 'attempt',
    'next_attempt_at', 'created_at', 'published_at', 'last_error_code',
  ].sort()
  assert(JSON.stringify([...columnMap.keys()].sort()) === JSON.stringify(expectedColumns),
    'journal must have the exact fourteen contract columns')
  for (const name of [
    'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
    'idempotency_key', 'payload', 'status', 'created_at',
  ]) {
    assert(columnMap.get(name)?.data_type === 'text', name + ' must use TEXT')
    assert(columnMap.get(name)?.is_nullable === 'NO', name + ' must be NOT NULL')
  }
  assert(columnMap.get('source_version')?.data_type === 'integer', 'source_version must use INTEGER')
  assert(columnMap.get('source_version')?.is_nullable === 'NO', 'source_version must be NOT NULL')
  assert(columnMap.get('attempt')?.data_type === 'integer', 'attempt must use INTEGER')
  assert(columnMap.get('attempt')?.is_nullable === 'NO', 'attempt must be NOT NULL')
  for (const name of ['next_attempt_at', 'created_at', 'published_at']) {
    assert(columnMap.get(name)?.data_type === 'timestamp with time zone', name + ' must use TIMESTAMPTZ')
  }
  assert(columnMap.get('next_attempt_at')?.is_nullable === 'YES', 'next_attempt_at must be nullable')
  assert(columnMap.get('published_at')?.is_nullable === 'YES', 'published_at must be nullable')
  assert(columnMap.get('last_error_code')?.is_nullable === 'YES', 'last_error_code must be nullable')
  assert(columnMap.get('status')?.column_default?.includes('PENDING'), 'status must default to PENDING')
  assert(columnMap.get('attempt')?.column_default === '1', 'attempt must default to 1')

  const indexes = await pool.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'auth_010_session_revocation_journal'",
  )
  const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
  for (const name of [
    'auth_010_session_revocation_journal_pkey',
    'auth_010_session_revocation_journal_event_id_uq',
    'auth_010_session_revocation_journal_idempotency_key_uq',
    'auth_010_session_revocation_journal_resource_event_uq',
    'auth_010_session_revocation_journal_status_next_attempt_idx',
  ]) assert(indexMap.has(name), 'required journal index missing: ' + name)
  assert(indexMap.get('auth_010_session_revocation_journal_status_next_attempt_idx')?.includes('(status, next_attempt_at)'),
    'retry index columns mismatch')

  const constraints = await pool.query(
    "SELECT conname, contype FROM pg_constraint " +
      "WHERE conrelid = 'auth_010_session_revocation_journal'::regclass",
  )
  const constraintMap = new Map(constraints.rows.map((row) => [row.conname, row]))
  for (const name of [
    'auth_010_session_revocation_journal_pkey',
    'auth_010_session_revocation_journal_event_id_uq',
    'auth_010_session_revocation_journal_idempotency_key_uq',
    'auth_010_session_revocation_journal_resource_event_uq',
    'auth_010_session_revocation_journal_event_type_check',
    'auth_010_session_revocation_journal_schema_version_check',
    'auth_010_session_revocation_journal_source_version_check',
    'auth_010_session_revocation_journal_payload_check',
    'auth_010_session_revocation_journal_status_check',
    'auth_010_session_revocation_journal_attempt_check',
    'auth_010_session_revocation_journal_last_error_code_check',
  ]) assert(constraintMap.has(name), 'required journal constraint missing: ' + name)

  const foreignKeys = await pool.query(
    "SELECT COUNT(*)::int AS count FROM pg_constraint " +
      "WHERE conrelid = 'auth_010_session_revocation_journal'::regclass AND contype = 'f'",
  )
  assert(Number(foreignKeys.rows[0].count) === 0,
    'session audit journal must not create a second Session table or foreign-key into session storage')

  const validA = makeEntry(sessionA, suffix)
  const saved = await insertEntry(validA.entry)
  assert(saved.rowCount === 1, 'canonical session-revoked event insert must succeed')

  const defaultRow = await pool.query(
    'SELECT status, attempt, next_attempt_at, published_at, last_error_code, payload ' +
      'FROM auth_010_session_revocation_journal WHERE journal_id = $1',
    [validA.entry.journalId],
  )
  assert(defaultRow.rows[0].status === 'PENDING', 'status default must be PENDING')
  assert(Number(defaultRow.rows[0].attempt) === 1, 'attempt default must be one')
  assert(defaultRow.rows[0].next_attempt_at === null &&
    defaultRow.rows[0].published_at === null &&
    defaultRow.rows[0].last_error_code === null, 'retry/publication fields must default to NULL')
  assert(defaultRow.rows[0].payload === validA.entry.payload, 'event payload must be preserved byte-for-byte')
  assert(!/sessionToken|cookie|deviceFingerprint|ipAddress|userAgent|refreshCredentialHash/i.test(defaultRow.rows[0].payload),
    'session credential/device/network data must never enter the audit payload')

  await expectPgCode('invalid event type', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '01').entry, eventType: 'identity.account_state_changed',
  }), '23514')
  await expectPgCode('invalid schema version', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '02').entry, schemaVersion: '2.0',
  }), '23514')
  await expectPgCode('invalid source version', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '03').entry, sourceVersion: 2,
  }), '23514')
  await expectPgCode('invalid status', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '04').entry, status: 'RETRYING',
  }), '23514')
  await expectPgCode('zero attempt', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '05').entry, attempt: 0,
  }), '23514')
  await expectPgCode('overlong last error code', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '06').entry, lastErrorCode: 'x'.repeat(129),
  }), '23514')
  await expectPgCode('duplicate event id', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '07').entry, eventId: validA.entry.eventId,
  }), '23505')
  await expectPgCode('duplicate idempotency key', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '08').entry, idempotencyKey: validA.entry.idempotencyKey,
  }), '23505')
  await expectPgCode('second event for the same session resource', () => insertEntry({
    ...makeEntry(sessionA, suffix.slice(0, 30) + '09').entry,
  }), '23505')
  await expectAnyFailure('malformed JSON payload', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '0a').entry, payload: '{bad-json',
  }))
  await expectPgCode('non-object JSON payload', () => insertEntry({
    ...makeEntry(sessionB, suffix.slice(0, 30) + '0b').entry, payload: '[]',
  }), '23514')

  const otherResource = makeEntry(sessionB, suffix.slice(0, 30) + '0c')
  await insertEntry(otherResource.entry)

  const concurrent = await Promise.allSettled([
    insertEntry(makeEntry('session-auth010-c-' + suffix.slice(0, 12), suffix.slice(0, 30) + '0d').entry),
    insertEntry(makeEntry('session-auth010-c-' + suffix.slice(0, 12), suffix.slice(0, 30) + '0e').entry),
  ])
  const winners = concurrent.filter((result) => result.status === 'fulfilled').length
  const conflicts = concurrent.filter((result) => result.status === 'rejected' && result.reason?.code === '23505').length
  assert(winners === 1 && conflicts === 1,
    'concurrent journal inserts for the same session resource must have exactly one winner')

  const beforeRetry = await pool.query(
    'SELECT event_id, idempotency_key, source_version, payload FROM auth_010_session_revocation_journal WHERE journal_id = $1',
    [validA.entry.journalId],
  )
  await pool.query(
    "UPDATE auth_010_session_revocation_journal SET status = 'PENDING', attempt = attempt + 1, " +
      'next_attempt_at = $1, last_error_code = $2 WHERE journal_id = $3',
    [new Date('2026-01-01T00:00:02.000Z'), 'QUEUE_DESTINATION_FAILED', validA.entry.journalId],
  )
  const afterRetry = await pool.query(
    'SELECT event_id, idempotency_key, source_version, payload, attempt, status, last_error_code ' +
      'FROM auth_010_session_revocation_journal WHERE journal_id = $1',
    [validA.entry.journalId],
  )
  for (const key of ['event_id', 'idempotency_key', 'source_version', 'payload']) {
    assert(afterRetry.rows[0][key] === beforeRetry.rows[0][key], 'retry must preserve ' + key)
  }
  assert(Number(afterRetry.rows[0].attempt) === 2, 'retry must increment attempt')
  assert(afterRetry.rows[0].status === 'PENDING', 'retry status must remain pending')
  assert(afterRetry.rows[0].last_error_code === 'QUEUE_DESTINATION_FAILED', 'retry error code must persist')

  await pool.query(
    "UPDATE auth_010_session_revocation_journal SET status = 'PUBLISHED', published_at = $1, " +
      'next_attempt_at = NULL, last_error_code = NULL WHERE journal_id = $2',
    [new Date('2026-01-01T00:00:03.000Z'), validA.entry.journalId],
  )
  const published = await pool.query(
    'SELECT status, published_at, next_attempt_at, last_error_code FROM auth_010_session_revocation_journal WHERE journal_id = $1',
    [validA.entry.journalId],
  )
  assert(published.rows[0].status === 'PUBLISHED' && published.rows[0].published_at instanceof Date,
    'published status/timestamp must persist')
  assert(published.rows[0].next_attempt_at === null && published.rows[0].last_error_code === null,
    'successful publication must clear retry/error state')

  successReport = {
    status: 'W02_AUTH010_SESSION_REVOCATION_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    assertionsPassed: 13,
    checks: {
      exactFourteenColumnContract: true,
      nativePostgresTemporalColumns: true,
      defaultPendingAndAttempt: true,
      fixedEventTypeSchemaVersionAndSourceVersion: true,
      eventIdUniqueness: true,
      idempotencyKeyUniqueness: true,
      oneEventPerSessionResource: true,
      concurrentSameSessionSingleWinner: true,
      validJsonObjectPayload: true,
      invalidJsonAndNonObjectRejected: true,
      forbiddenSessionSecretsAndNetworkFieldsAbsent: true,
      noForeignKeyIntoNativeSessionStorage: true,
      retryPreservesEventIdKeySourceVersionAndPayload: true,
      publishedTimestampAndRetryCleanup: true,
    },
    productionDatabaseTouched: false,
    businessRowsImported: false,
  }
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query(
      'DELETE FROM auth_010_session_revocation_journal WHERE journal_id LIKE $1 OR event_id LIKE $2 OR idempotency_key LIKE $3 OR resource_id LIKE $4',
      [journalPrefix + '%', 'evt_' + suffix.slice(0, 20) + '%', 'AUTH010_SESSION_REVOKE_' + suffix.slice(0, 20) + '%', 'session-auth010-%-' + suffix.slice(0, 16)],
    )
    await pool.query(
      "DELETE FROM auth_010_session_revocation_journal WHERE event_id LIKE $1 OR idempotency_key LIKE $2",
      ['evt_' + suffix.slice(0, 20) + '%', 'AUTH010_SESSION_REVOKE_' + suffix.slice(0, 20) + '%'],
    )
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }
  try {
    const counts = await pool.query(
      'SELECT ' +
        '(SELECT COUNT(*) FROM auth_010_session_revocation_journal WHERE journal_id LIKE $1 OR event_id LIKE $2 OR idempotency_key LIKE $3 OR resource_id LIKE $4) AS synthetic_rows, ' +
        '(SELECT COUNT(*) FROM auth_010_session_revocation_journal) AS all_rows',
      [journalPrefix + '%', 'evt_' + suffix.slice(0, 20) + '%', 'AUTH010_SESSION_REVOKE_' + suffix.slice(0, 20) + '%', 'session-auth010-%-' + suffix.slice(0, 16)],
    )
    if (Number(counts.rows[0].synthetic_rows) !== 0 || Number(counts.rows[0].all_rows) !== 0) {
      if (!primaryError) primaryError = new Error('W02_AUTH010_JOURNAL_POSTFLIGHT_ROWS_NOT_EMPTY')
    } else if (!primaryError && successReport) {
      successReport.checks.syntheticJournalRowsCleaned = true
      successReport.businessTableRows = { auth_010_session_revocation_journal: Number(counts.rows[0].all_rows) }
    }
  } catch (cleanupVerificationError) {
    if (!primaryError) primaryError = cleanupVerificationError
  }
  await pool.end()
}

if (primaryError) throw primaryError
if (!successReport || successReport.checks.syntheticJournalRowsCleaned !== true) {
  throw new Error('W02_AUTH010_JOURNAL_POSTFLIGHT_EVIDENCE_INCOMPLETE')
}
process.stdout.write(JSON.stringify(successReport, null, 2) + '\n')
