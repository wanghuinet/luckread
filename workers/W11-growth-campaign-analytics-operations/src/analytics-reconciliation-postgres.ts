import type {
  AnalyticsPostgresClient,
  AnalyticsPostgresPool,
} from './analytics-postgres-store.js'

const CANONICAL_UTC_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/
const ADVISORY_LOCK_SQL = "SELECT pg_advisory_lock(hashtext('luckread:w11:analytics-reconciliation'))"
const ADVISORY_UNLOCK_SQL = "SELECT pg_advisory_unlock(hashtext('luckread:w11:analytics-reconciliation'))"

const START_RECONCILIATION_SQL = `
INSERT INTO analytics_projection_rebuild_state (
  singleton_id, run_id, hour_start, status, started_at, completed_at,
  content_buckets_rebuilt, creator_buckets_rebuilt, error_code
)
VALUES (
  1, $1, $2, 'RUNNING',
  to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  NULL, NULL, NULL, NULL
)
ON CONFLICT(singleton_id) DO UPDATE SET
  run_id = EXCLUDED.run_id,
  hour_start = EXCLUDED.hour_start,
  status = 'RUNNING',
  started_at = EXCLUDED.started_at,
  completed_at = NULL,
  content_buckets_rebuilt = NULL,
  creator_buckets_rebuilt = NULL,
  error_code = NULL
WHERE analytics_projection_rebuild_state.singleton_id = 1
`

const REPLAY_LATE_FOR_HOUR_SQL = `
UPDATE analytics_event_dedupe
SET projection_status = 'PENDING'
WHERE hour_start = $1 AND projection_status = 'LATE'
`

const DELETE_CONTENT_HOUR_SQL =
  'DELETE FROM analytics_content_hourly WHERE hour_start = $1'

const REBUILD_CONTENT_HOUR_SQL = `
INSERT INTO analytics_content_hourly (
  hour_start, content_id, content_type, metric_version,
  impressions, opens, read_starts, read_progress_25, read_progress_50, read_progress_75,
  read_completions, read_duration_ms, read_duration_events, dwell_duration_ms, dwell_events,
  completed_views, video_impressions, video_play_requests, video_plays, video_progress_25,
  video_progress_50, video_progress_75, video_progress_90, video_completions, video_replays,
  video_watch_ms, video_watch_events, likes, comments, shares, favorites
)
SELECT
  hour_start, content_id, content_type, metric_version,
  SUM(CASE WHEN event_name = 'content_impression' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'content_open' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_start' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_progress_25' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_progress_50' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_progress_75' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_complete' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_dwell' THEN COALESCE(duration_ms, 0) ELSE 0 END),
  SUM(CASE WHEN event_name = 'read_dwell' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'dwell' THEN COALESCE(duration_ms, 0) ELSE 0 END),
  SUM(CASE WHEN event_name = 'dwell' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'complete_view' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_impression' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_play_request' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_play_success' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_progress_25' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_progress_50' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_progress_75' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_progress_90' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_complete' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_replay' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_watch' THEN COALESCE(duration_ms, 0) ELSE 0 END),
  SUM(CASE WHEN event_name = 'video_watch' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'like_created' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'comment_created' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'share_created' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'favorite_created' THEN 1 ELSE 0 END)
FROM analytics_event_dedupe
WHERE hour_start = $1
  AND projection_status <> 'LATE'
  AND event_name NOT IN ('follow_created', 'follow_removed')
GROUP BY hour_start, content_type, content_id, metric_version
`

const DELETE_CREATOR_HOUR_SQL =
  'DELETE FROM analytics_creator_hourly WHERE hour_start = $1'

const REBUILD_CREATOR_HOUR_SQL = `
INSERT INTO analytics_creator_hourly (
  hour_start, creator_id, metric_version, followers_gained, followers_lost
)
SELECT
  hour_start,
  creator_id,
  metric_version,
  SUM(CASE WHEN event_name = 'follow_created' THEN 1 ELSE 0 END),
  SUM(CASE WHEN event_name = 'follow_removed' THEN 1 ELSE 0 END)
FROM analytics_event_dedupe
WHERE hour_start = $1
  AND projection_status <> 'LATE'
  AND event_name IN ('follow_created', 'follow_removed')
GROUP BY hour_start, creator_id, metric_version
`

const MARK_HOUR_APPLIED_SQL = `
UPDATE analytics_event_dedupe
SET projection_status = 'APPLIED'
WHERE hour_start = $1 AND projection_status = 'PENDING'
`

const FINALIZE_RECONCILIATION_SQL = `
UPDATE analytics_projection_rebuild_state
SET
  status = 'SUCCEEDED',
  content_buckets_rebuilt = $4,
  creator_buckets_rebuilt = $5,
  completed_at = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  error_code = NULL
WHERE singleton_id = 1 AND run_id = $3 AND status = 'RUNNING'
RETURNING content_buckets_rebuilt, creator_buckets_rebuilt
`

const FAIL_RECONCILIATION_SQL = `
UPDATE analytics_projection_rebuild_state
SET
  status = 'FAILED',
  error_code = $1,
  completed_at = to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
WHERE singleton_id = 1 AND run_id = $2 AND status = 'RUNNING'
`

export interface ReconcileAnalyticsHourPostgresResult {
  runId: string
  hourStart: string
  status: 'SUCCEEDED'
  contentBucketsRebuilt: number
  creatorBucketsRebuilt: number
  lateEventsReplayed?: number
}

export interface ReconcileAnalyticsHourPostgresOptions {
  replayLateEvents?: boolean
}

type ReconciliationFailureCode =
  | 'REBUILD_FAILED'
  | 'REBUILD_BATCH_INCOMPLETE'
  | 'REBUILD_FINALIZE_FAILED'

function assertCanonicalUtcHour(value: string): void {
  if (!CANONICAL_UTC_HOUR.test(value)) {
    throw new RangeError('hourStart must be a canonical UTC hour boundary')
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new RangeError('hourStart must be a real UTC calendar hour')
  }
}

async function runDml(
  client: AnalyticsPostgresClient,
  sql: string,
  values: (string | number | null)[] = [],
): Promise<number> {
  const result = await client.query(sql, values)
  if (!Number.isSafeInteger(result.rowCount) || (result.rowCount ?? -1) < 0) {
    throw new Error('REBUILD_BATCH_INCOMPLETE')
  }
  return result.rowCount ?? 0
}

/**
 * Rebuild one canonical UTC hour from W11's deduplicated event ledger.
 * A session advisory lock serializes repairs across Worker isolates; projection
 * replacement and the success marker commit in one PostgreSQL transaction.
 * The singleton status row remains visible as RUNNING during the rebuild.
 */
export async function reconcileAnalyticsHourPostgres(
  pool: AnalyticsPostgresPool,
  hourStart: string,
  options: ReconcileAnalyticsHourPostgresOptions = {},
): Promise<ReconcileAnalyticsHourPostgresResult> {
  assertCanonicalUtcHour(hourStart)
  const runId = crypto.randomUUID()
  const replayLateEvents = options.replayLateEvents === true
  const client = await pool.connect()
  let lockHeld = false
  let started = false
  let transactionStarted = false
  let failureCode: ReconciliationFailureCode = 'REBUILD_FAILED'

  try {
    await client.query(ADVISORY_LOCK_SQL)
    lockHeld = true

    const start = await client.query(START_RECONCILIATION_SQL, [runId, hourStart])
    if (start.rowCount !== 1) throw new Error('RECONCILIATION_START_FAILED')
    started = true

    await client.query('BEGIN')
    transactionStarted = true

    const lateEventsReplayed = replayLateEvents
      ? await runDml(client, REPLAY_LATE_FOR_HOUR_SQL, [hourStart])
      : undefined

    await runDml(client, DELETE_CONTENT_HOUR_SQL, [hourStart])
    const contentBucketsRebuilt = await runDml(client, REBUILD_CONTENT_HOUR_SQL, [hourStart])
    await runDml(client, DELETE_CREATOR_HOUR_SQL, [hourStart])
    const creatorBucketsRebuilt = await runDml(client, REBUILD_CREATOR_HOUR_SQL, [hourStart])
    await runDml(client, MARK_HOUR_APPLIED_SQL, [hourStart])

    const finalized = await client.query(FINALIZE_RECONCILIATION_SQL, [
      hourStart,
      hourStart,
      runId,
      contentBucketsRebuilt,
      creatorBucketsRebuilt,
    ])
    if (finalized.rowCount !== 1 || finalized.rows.length !== 1) {
      failureCode = 'REBUILD_FINALIZE_FAILED'
      throw new Error('RECONCILIATION_FINALIZE_FAILED')
    }

    await client.query('COMMIT')
    transactionStarted = false
    return {
      runId,
      hourStart,
      status: 'SUCCEEDED',
      contentBucketsRebuilt,
      creatorBucketsRebuilt,
      ...(replayLateEvents ? { lateEventsReplayed: lateEventsReplayed ?? 0 } : {}),
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original failure while keeping provider details private.
      }
    }
    if (error instanceof Error && error.message === 'REBUILD_BATCH_INCOMPLETE') {
      failureCode = 'REBUILD_BATCH_INCOMPLETE'
    }
    if (started) {
      try {
        await client.query(FAIL_RECONCILIATION_SQL, [failureCode, runId])
      } catch {
        // A provider outage may leave RUNNING as the last visible state.
      }
    }
    throw new Error(started
      ? 'PostgreSQL analytics reconciliation failed'
      : 'PostgreSQL analytics reconciliation could not start')
  } finally {
    if (lockHeld) {
      try {
        await client.query(ADVISORY_UNLOCK_SQL)
      } catch {
        // Releasing the client also releases a session-level advisory lock.
      }
    }
    client.release()
  }
}

export type AnalyticsProjectionRebuildStatus =
  | {
      runId: string
      hourStart: string
      status: 'RUNNING'
      startedAt: string
      completedAt: null
      contentBucketsRebuilt: null
      creatorBucketsRebuilt: null
      errorCode: null
    }
  | {
      runId: string
      hourStart: string
      status: 'SUCCEEDED'
      startedAt: string
      completedAt: string
      contentBucketsRebuilt: number
      creatorBucketsRebuilt: number
      errorCode: null
    }
  | {
      runId: string
      hourStart: string
      status: 'FAILED'
      startedAt: string
      completedAt: string
      contentBucketsRebuilt: number | null
      creatorBucketsRebuilt: number | null
      errorCode: ReconciliationFailureCode
    }

const LATEST_REBUILD_STATUS_SQL = `
SELECT run_id, hour_start, status, started_at, completed_at,
       content_buckets_rebuilt, creator_buckets_rebuilt, error_code
FROM analytics_projection_rebuild_state
WHERE singleton_id = 1
LIMIT 1
`

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANONICAL_UTC_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const VALID_ERROR_CODES = new Set<ReconciliationFailureCode>([
  'REBUILD_FAILED',
  'REBUILD_BATCH_INCOMPLETE',
  'REBUILD_FINALIZE_FAILED',
])

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_UTC_MILLIS.test(value)) return false
  const instant = Date.parse(value)
  return Number.isFinite(instant) && new Date(instant).toISOString() === value
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function invalidStatus(): never {
  throw new Error('Stored analytics projection rebuild status is invalid')
}

function numericCount(value: unknown): number {
  const count = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(count) || count < 0) return invalidStatus()
  return count
}

/** Read the bounded singleton repair marker without exposing provider fields. */
export async function getLatestAnalyticsProjectionRebuildStatusPostgres(
  pool: AnalyticsPostgresPool,
): Promise<AnalyticsProjectionRebuildStatus | null> {
  const result = await pool.query<Record<string, unknown>>(LATEST_REBUILD_STATUS_SQL)
  const row = result.rows[0]
  if (!row) return null

  if (
    typeof row.run_id !== 'string' ||
    !UUID_PATTERN.test(row.run_id) ||
    typeof row.hour_start !== 'string' ||
    !CANONICAL_UTC_HOUR.test(row.hour_start) ||
    !Number.isFinite(Date.parse(row.hour_start)) ||
    new Date(Date.parse(row.hour_start)).toISOString() !== row.hour_start ||
    !isCanonicalInstant(row.started_at)
  ) return invalidStatus()

  const base = {
    runId: row.run_id,
    hourStart: row.hour_start,
    startedAt: row.started_at,
  }

  if (row.status === 'RUNNING') {
    if (
      row.completed_at !== null ||
      row.content_buckets_rebuilt !== null ||
      row.creator_buckets_rebuilt !== null ||
      row.error_code !== null
    ) return invalidStatus()
    return {
      ...base,
      status: 'RUNNING',
      completedAt: null,
      contentBucketsRebuilt: null,
      creatorBucketsRebuilt: null,
      errorCode: null,
    }
  }

  if (row.status === 'SUCCEEDED') {
    if (!isCanonicalInstant(row.completed_at) || row.error_code !== null) return invalidStatus()
    return {
      ...base,
      status: 'SUCCEEDED',
      completedAt: row.completed_at,
      contentBucketsRebuilt: numericCount(row.content_buckets_rebuilt),
      creatorBucketsRebuilt: numericCount(row.creator_buckets_rebuilt),
      errorCode: null,
    }
  }

  if (row.status === 'FAILED') {
    if (
      !isCanonicalInstant(row.completed_at) ||
      (row.content_buckets_rebuilt !== null && !isNonNegativeSafeInteger(row.content_buckets_rebuilt)) ||
      (row.creator_buckets_rebuilt !== null && !isNonNegativeSafeInteger(row.creator_buckets_rebuilt)) ||
      typeof row.error_code !== 'string' ||
      !VALID_ERROR_CODES.has(row.error_code as ReconciliationFailureCode)
    ) return invalidStatus()
    return {
      ...base,
      status: 'FAILED',
      completedAt: row.completed_at,
      contentBucketsRebuilt: row.content_buckets_rebuilt as number | null,
      creatorBucketsRebuilt: row.creator_buckets_rebuilt as number | null,
      errorCode: row.error_code as ReconciliationFailureCode,
    }
  }

  return invalidStatus()
}
