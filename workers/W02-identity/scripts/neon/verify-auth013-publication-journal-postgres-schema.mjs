import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const connectionString = process.env.W02_SCHEMA_DATABASE_URL
if (!connectionString) throw new Error('W02_SCHEMA_DATABASE_URL is required')

const pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 })
const suffix = randomUUID().replaceAll('-', '').slice(0, 18)
const journalPrefix = 'auth013-journal-' + suffix + '-'
const resourceA = 'auth013-user-a-' + suffix
const resourceB = 'auth013-user-b-' + suffix
const createdAt = new Date('2026-01-01T00:00:00.000Z')
const payload = JSON.stringify({
  eventId: 'auth013-event-' + suffix,
  eventType: 'identity.account_state_changed',
  schemaVersion: '1.0',
  producer: 'W02',
  resourceType: 'User',
  resourceId: resourceA,
  occurredAt: '2026-01-01T00:00:00.000Z',
  publishedAt: '2026-01-01T00:00:00.000Z',
  correlationId: 'auth013-correlation-' + suffix,
  causationId: 'auth013-causation-' + suffix,
  idempotencyKey: 'auth013-' + suffix,
  attempt: 1,
  sourceVersion: 2,
  actor: { actorId: 'auth013-operator-' + suffix, actorType: 'user', operationalRole: 'PLATFORM_OPERATOR' },
  before: { accountState: 'ACTIVE', accountStateVersion: 1 },
  after: { accountState: 'RESTRICTED', accountStateVersion: 2 },
  reason: 'schema-only PostgreSQL journal probe',
})

const assert = (condition, message) => {
  if (!condition) throw new Error('W02_AUTH013_JOURNAL_PG_ASSERTION_FAILED: ' + message)
}
const expectPgCode = async (label, operation, expectedCode) => {
  try {
    await operation()
  } catch (error) {
    assert(error && error.code === expectedCode,
      label + ' expected SQLSTATE ' + expectedCode + ', got ' + String(error?.code ?? 'unknown'))
    return
  }
  throw new Error('W02_AUTH013_JOURNAL_PG_ASSERTION_FAILED: ' + label + ' unexpectedly succeeded')
}
const insertJournal = ({
  journalId,
  eventId,
  resourceId = resourceA,
  eventType = 'identity.account_state_changed',
  schemaVersion = '1.0',
  sourceVersion = 2,
  payloadText = payload,
  status,
  attempt,
  lastErrorCode = null,
  nextAttemptAt = null,
  publishedAt = null,
} = {}) => {
  const columns = [
    'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
    'source_version', 'payload', 'created_at',
  ]
  const values = [
    journalId, eventId, eventType, schemaVersion, resourceId,
    sourceVersion, payloadText, createdAt,
  ]
  if (status !== undefined) { columns.push('status'); values.push(status) }
  if (attempt !== undefined) { columns.push('attempt'); values.push(attempt) }
  if (lastErrorCode !== null) { columns.push('last_error_code'); values.push(lastErrorCode) }
  if (nextAttemptAt !== null) { columns.push('next_attempt_at'); values.push(nextAttemptAt) }
  if (publishedAt !== null) { columns.push('published_at'); values.push(publishedAt) }
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(', ')
  return pool.query(
    'INSERT INTO auth_013_publication_journal (' + columns.join(', ') + ') VALUES (' + placeholders + ')',
    values,
  )
}

let assertionsPassed = 0
let successReport
let primaryError
try {
  const identity = await pool.query(
    "SELECT current_setting('server_version_num')::integer AS version_num, current_database() AS database_name",
  )
  const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10000)
  assert(postgresMajor === 18, 'PostgreSQL 18 required')
  assert(identity.rows[0].database_name === 'luckread_schema', 'unexpected database target')
  assertionsPassed++

  const columns = await pool.query(
    "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'auth_013_publication_journal'",
  )
  const columnMap = new Map(columns.rows.map((row) => [row.column_name, row]))
  const expectedColumns = [
    'journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id',
    'source_version', 'payload', 'status', 'attempt', 'next_attempt_at',
    'created_at', 'published_at', 'last_error_code',
  ].sort()
  assert(JSON.stringify([...columnMap.keys()].sort()) === JSON.stringify(expectedColumns),
    'journal columns must exactly match the 13-column contract')
  for (const name of ['journal_id', 'event_id', 'event_type', 'schema_version', 'resource_id', 'payload', 'status', 'created_at']) {
    assert(columnMap.get(name)?.data_type === 'text', name + ' must use TEXT')
    assert(columnMap.get(name)?.is_nullable === 'NO', name + ' must be NOT NULL')
  }
  assert(columnMap.get('source_version')?.data_type === 'integer', 'source_version must be INTEGER')
  assert(columnMap.get('source_version')?.is_nullable === 'NO', 'source_version must be NOT NULL')
  assert(columnMap.get('attempt')?.data_type === 'integer', 'attempt must be INTEGER')
  assert(columnMap.get('attempt')?.is_nullable === 'NO', 'attempt must be NOT NULL')
  assert(columnMap.get('next_attempt_at')?.data_type === 'timestamp with time zone', 'next_attempt_at must be TIMESTAMPTZ')
  assert(columnMap.get('created_at')?.data_type === 'timestamp with time zone', 'created_at must be TIMESTAMPTZ')
  assert(columnMap.get('published_at')?.data_type === 'timestamp with time zone', 'published_at must be TIMESTAMPTZ')
  assert(columnMap.get('last_error_code')?.is_nullable === 'YES', 'last_error_code must be nullable')
  assert(columnMap.get('status')?.column_default?.includes('PENDING'), 'status must default to PENDING')
  assert(columnMap.get('attempt')?.column_default === '1', 'attempt must default to 1')
  assertionsPassed++

  const indexes = await pool.query(
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'auth_013_publication_journal'",
  )
  const indexMap = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
  for (const name of [
    'auth_013_publication_journal_pkey',
    'auth_013_publication_journal_event_id_uq',
    'auth_013_publication_journal_resource_version_uq',
    'auth_013_publication_journal_status_next_attempt_idx',
  ]) assert(indexMap.has(name), 'required journal index missing: ' + name)
  assert(indexMap.get('auth_013_publication_journal_status_next_attempt_idx')?.includes('(status, next_attempt_at)'),
    'retry index columns mismatch')
  assertionsPassed++

  const constraints = await pool.query(
    "SELECT conname, contype, pg_get_constraintdef(oid) AS definition " +
      "FROM pg_constraint WHERE conrelid = 'auth_013_publication_journal'::regclass",
  )
  const defs = new Map(constraints.rows.map((row) => [row.conname, row]))
  assert(defs.get('auth_013_publication_journal_pkey')?.contype === 'p', 'journal primary key missing')
  assert(defs.get('auth_013_publication_journal_event_id_uq')?.contype === 'u', 'event_id unique constraint missing')
  assert(defs.get('auth_013_publication_journal_resource_version_uq')?.contype === 'u',
    'resource/event/source-version unique constraint missing')
  for (const name of [
    'auth_013_publication_journal_event_type_check',
    'auth_013_publication_journal_schema_version_check',
    'auth_013_publication_journal_source_version_check',
    'auth_013_publication_journal_status_check',
    'auth_013_publication_journal_attempt_check',
    'auth_013_publication_journal_last_error_code_check',
  ]) assert(defs.has(name), 'required check constraint missing: ' + name)
  assertionsPassed++

  const event = await insertJournal({
    journalId: journalPrefix + 'defaults',
    eventId: 'auth013-event-' + suffix + '-defaults',
  })
  assert(event.rowCount === 1, 'canonical pending event insert must succeed')
  const defaultRow = await pool.query(
    'SELECT status, attempt, next_attempt_at, published_at, last_error_code, payload ' +
      'FROM auth_013_publication_journal WHERE journal_id = $1',
    [journalPrefix + 'defaults'],
  )
  assert(defaultRow.rows[0].status === 'PENDING', 'status default must be PENDING')
  assert(Number(defaultRow.rows[0].attempt) === 1, 'attempt default must be 1')
  assert(defaultRow.rows[0].next_attempt_at === null && defaultRow.rows[0].published_at === null &&
    defaultRow.rows[0].last_error_code === null, 'nullable retry/publication fields must default to NULL')
  assert(defaultRow.rows[0].payload === payload, 'payload must be stored byte-for-byte')
  assertionsPassed++

  await expectPgCode('wrong event type', () => insertJournal({
    journalId: journalPrefix + 'wrong-type',
    eventId: 'auth013-event-' + suffix + '-wrong-type',
    eventType: 'identity.other_event',
    sourceVersion: 10,
  }), '23514')
  await expectPgCode('wrong schema version', () => insertJournal({
    journalId: journalPrefix + 'wrong-schema',
    eventId: 'auth013-event-' + suffix + '-wrong-schema',
    schemaVersion: '2.0',
    sourceVersion: 11,
  }), '23514')
  await expectPgCode('non-positive source version', () => insertJournal({
    journalId: journalPrefix + 'zero-source-version',
    eventId: 'auth013-event-' + suffix + '-zero-source-version',
    sourceVersion: 0,
  }), '23514')
  await expectPgCode('invalid status', () => insertJournal({
    journalId: journalPrefix + 'invalid-status',
    eventId: 'auth013-event-' + suffix + '-invalid-status',
    status: 'RETRYING',
    sourceVersion: 12,
  }), '23514')
  await expectPgCode('non-positive attempt', () => insertJournal({
    journalId: journalPrefix + 'zero-attempt',
    eventId: 'auth013-event-' + suffix + '-zero-attempt',
    attempt: 0,
    sourceVersion: 13,
  }), '23514')
  await expectPgCode('oversized last error code', () => insertJournal({
    journalId: journalPrefix + 'long-error',
    eventId: 'auth013-event-' + suffix + '-long-error',
    lastErrorCode: 'x'.repeat(129),
    sourceVersion: 14,
  }), '23514')
  assertionsPassed++

  await expectPgCode('duplicate event id', () => insertJournal({
    journalId: journalPrefix + 'duplicate-event',
    eventId: 'auth013-event-' + suffix + '-defaults',
    resourceId: resourceB,
    sourceVersion: 1,
  }), '23505')
  await expectPgCode('duplicate resource/event/version', () => insertJournal({
    journalId: journalPrefix + 'duplicate-resource-version',
    eventId: 'auth013-event-' + suffix + '-duplicate-resource-version',
  }), '23505')
  assertionsPassed++

  // A new state version may have its own journal row for the same resource.
  await insertJournal({
    journalId: journalPrefix + 'next-version',
    eventId: 'auth013-event-' + suffix + '-next-version',
    sourceVersion: 3,
  })
  // Different resources can publish the same per-resource version.
  await insertJournal({
    journalId: journalPrefix + 'other-resource',
    eventId: 'auth013-event-' + suffix + '-other-resource',
    resourceId: resourceB,
    sourceVersion: 2,
  })
  assertionsPassed++

  const concurrent = await Promise.allSettled([
    insertJournal({
      journalId: journalPrefix + 'concurrent-a',
      eventId: 'auth013-event-' + suffix + '-concurrent-a',
      resourceId: resourceB,
      sourceVersion: 9,
    }),
    insertJournal({
      journalId: journalPrefix + 'concurrent-b',
      eventId: 'auth013-event-' + suffix + '-concurrent-b',
      resourceId: resourceB,
      sourceVersion: 9,
    }),
  ])
  const winners = concurrent.filter((result) => result.status === 'fulfilled').length
  const conflicts = concurrent.filter((result) => result.status === 'rejected' && result.reason?.code === '23505').length
  assert(winners === 1 && conflicts === 1,
    'concurrent duplicate resource/event/version journal inserts must have exactly one winner')
  assertionsPassed++

  const beforeRetry = await pool.query(
    'SELECT event_id, source_version, payload FROM auth_013_publication_journal WHERE journal_id = $1',
    [journalPrefix + 'defaults'],
  )
  await pool.query(
    "UPDATE auth_013_publication_journal SET status = 'PENDING', attempt = attempt + 1, " +
      'next_attempt_at = $1, last_error_code = $2 WHERE journal_id = $3',
    [new Date('2026-01-01T00:00:02.000Z'), 'QUEUE_DESTINATION_FAILED', journalPrefix + 'defaults'],
  )
  const afterRetry = await pool.query(
    'SELECT event_id, source_version, payload, attempt, status, last_error_code ' +
      'FROM auth_013_publication_journal WHERE journal_id = $1',
    [journalPrefix + 'defaults'],
  )
  assert(afterRetry.rows[0].event_id === beforeRetry.rows[0].event_id, 'retry must reuse the same event id')
  assert(Number(afterRetry.rows[0].source_version) === Number(beforeRetry.rows[0].source_version),
    'retry must not advance source version')
  assert(afterRetry.rows[0].payload === beforeRetry.rows[0].payload, 'retry must not mutate event payload')
  assert(Number(afterRetry.rows[0].attempt) === 2, 'retry must increment attempt')
  assert(afterRetry.rows[0].status === 'PENDING', 'retry must remain pending until all destinations accept')
  assert(afterRetry.rows[0].last_error_code === 'QUEUE_DESTINATION_FAILED', 'retry error code must persist')
  assertionsPassed++

  await pool.query(
    "UPDATE auth_013_publication_journal SET status = 'PUBLISHED', published_at = $1, " +
      'next_attempt_at = NULL, last_error_code = NULL WHERE journal_id = $2',
    [new Date('2026-01-01T00:00:03.000Z'), journalPrefix + 'defaults'],
  )
  const published = await pool.query(
    'SELECT status, published_at, next_attempt_at, last_error_code FROM auth_013_publication_journal WHERE journal_id = $1',
    [journalPrefix + 'defaults'],
  )
  assert(published.rows[0].status === 'PUBLISHED' && published.rows[0].published_at instanceof Date,
    'successful publication timestamp must persist as TIMESTAMPTZ')
  assert(published.rows[0].next_attempt_at === null && published.rows[0].last_error_code === null,
    'successful publication must clear retry/error state')
  assertionsPassed++

  successReport = {
    status: 'W02_AUTH013_PUBLICATION_JOURNAL_POSTGRES_SCHEMA_PASS',
    postgresMajor,
    assertionsPassed,
    checks: {
      exactThirteenColumnContract: true,
      nativePostgresTemporalColumns: true,
      defaultPendingStateAndAttempt: true,
      fixedEventTypeAndSchemaVersion: true,
      positiveSourceVersionAndAttempt: true,
      boundedLastErrorCode: true,
      eventIdUniqueness: true,
      resourceEventVersionUniqueness: true,
      concurrentDuplicateJournalSingleWinner: true,
      multipleVersionsPerResourceAllowed: true,
      sameVersionAcrossResourcesAllowed: true,
      retryReusesEventIdAndPayload: true,
      retryAttemptAndStatePersist: true,
      publishedTimestampPersistsAndClearsRetry: true,
    },
    productionDatabaseTouched: false,
    businessRowsImported: false,
  }
} catch (error) {
  primaryError = error
} finally {
  try {
    await pool.query(
      'DELETE FROM auth_013_publication_journal WHERE journal_id LIKE $1 OR event_id LIKE $2 OR resource_id LIKE $3',
      [journalPrefix + '%', 'auth013-event-' + suffix + '%', 'auth013-user-%-' + suffix],
    )
  } catch (cleanupError) {
    if (!primaryError) primaryError = cleanupError
  }
  try {
    const remaining = await pool.query(
      'SELECT ' +
        '(SELECT COUNT(*) FROM auth_013_publication_journal WHERE journal_id LIKE $1 OR event_id LIKE $2 OR resource_id LIKE $3) AS synthetic_rows, ' +
        '(SELECT COUNT(*) FROM auth_013_publication_journal) AS all_rows',
      [journalPrefix + '%', 'auth013-event-' + suffix + '%', 'auth013-user-%-' + suffix],
    )
    const counts = remaining.rows[0]
    if (Number(counts.synthetic_rows) !== 0 || Number(counts.all_rows) !== 0) {
      if (!primaryError) primaryError = new Error('W02_AUTH013_JOURNAL_POSTFLIGHT_ROWS_NOT_EMPTY')
    } else if (!primaryError && successReport) {
      successReport.checks.syntheticJournalRowsCleaned = true
      successReport.businessTableRows = { auth_013_publication_journal: Number(counts.all_rows) }
    }
  } catch (cleanupVerificationError) {
    if (!primaryError) primaryError = cleanupVerificationError
  }
  await pool.end()
}

if (primaryError) throw primaryError
if (!successReport || successReport.checks.syntheticJournalRowsCleaned !== true) {
  throw new Error('W02_AUTH013_JOURNAL_POSTFLIGHT_EVIDENCE_INCOMPLETE')
}
process.stdout.write(JSON.stringify(successReport, null, 2) + '\n')
