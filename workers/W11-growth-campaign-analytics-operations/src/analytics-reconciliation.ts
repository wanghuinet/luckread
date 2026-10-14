import type {
  AnalyticsD1Database,
  AnalyticsD1Result,
} from './analytics-d1-store'

const CANONICAL_UTC_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/

const DELETE_CONTENT_HOUR_SQL = String.raw`DELETE FROM analytics_content_hourly WHERE hour_start = ?`

const REBUILD_CONTENT_HOUR_SQL = String.raw`
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
WHERE hour_start = ?
  AND event_name NOT IN ('follow_created', 'follow_removed')
GROUP BY hour_start, content_type, content_id, metric_version
`

const DELETE_CREATOR_HOUR_SQL = String.raw`DELETE FROM analytics_creator_hourly WHERE hour_start = ?`

const REBUILD_CREATOR_HOUR_SQL = String.raw`
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
WHERE hour_start = ?
  AND event_name IN ('follow_created', 'follow_removed')
GROUP BY hour_start, creator_id, metric_version
`

const MARK_HOUR_APPLIED_SQL = String.raw`
UPDATE analytics_event_dedupe
SET projection_status = 'APPLIED'
WHERE hour_start = ? AND projection_status = 'PENDING'
`

const START_RECONCILIATION_SQL = String.raw`
INSERT INTO analytics_projection_rebuild_state (
  singleton_id, run_id, hour_start, status, started_at, completed_at,
  content_buckets_rebuilt, creator_buckets_rebuilt, error_code
)
VALUES (
  1, ?, ?, 'RUNNING', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL, NULL, NULL, NULL
)
ON CONFLICT(singleton_id) DO UPDATE SET
  run_id = excluded.run_id,
  hour_start = excluded.hour_start,
  status = 'RUNNING',
  started_at = excluded.started_at,
  completed_at = NULL,
  content_buckets_rebuilt = NULL,
  creator_buckets_rebuilt = NULL,
  error_code = NULL
`

const FINALIZE_RECONCILIATION_SQL = String.raw`
UPDATE analytics_projection_rebuild_state
SET
  status = 'SUCCEEDED',
  content_buckets_rebuilt = (
    SELECT COUNT(*) FROM analytics_content_hourly WHERE hour_start = ?
  ),
  creator_buckets_rebuilt = (
    SELECT COUNT(*) FROM analytics_creator_hourly WHERE hour_start = ?
  ),
  completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  error_code = NULL
WHERE singleton_id = 1 AND run_id = ? AND status = 'RUNNING'
`

const FAIL_RECONCILIATION_SQL = String.raw`
UPDATE analytics_projection_rebuild_state
SET
  status = 'FAILED',
  error_code = ?,
  completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE singleton_id = 1 AND run_id = ? AND status = 'RUNNING'
`

export interface ReconcileAnalyticsHourResult {
  runId: string
  hourStart: string
  status: 'SUCCEEDED'
  /** Null only if the D1 driver omits affected-row metadata. */
  contentBucketsRebuilt: number | null
  /** Null only if the D1 driver omits affected-row metadata. */
  creatorBucketsRebuilt: number | null
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
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== value
  ) {
    throw new RangeError('hourStart must be a real UTC calendar hour')
  }
}

function affectedRows(result: AnalyticsD1Result | undefined): number | null {
  const changes = result?.meta?.changes
  return Number.isSafeInteger(changes) && (changes ?? -1) >= 0
    ? changes as number
    : null
}

function assertBatchSucceeded(
  results: AnalyticsD1Result[],
  expectedLength: number,
): void {
  if (results.length !== expectedLength) {
    throw new Error('D1 analytics reconciliation returned an unexpected result count')
  }
  if (results.some((result) => result.success === false)) {
    throw new Error('D1 analytics reconciliation batch failed')
  }
}

/**
 * Rebuild exactly one UTC hourly bucket from W11's durable, deduplicated event
 * ledger. The ledger is the source for this derived projection; this does not
 * reconcile or replace W03/W05 authoritative business facts.
 *
 * A fixed-size singleton state row exposes only the latest repair's status,
 * counts and sanitized error code. This avoids growing a job-history table
 * without an approved retention policy. Projection replacement and its success
 * marker commit in the same D1 batch transaction; failures are marked FAILED
 * separately on a best-effort basis. Overlapping runs are guarded by runId.
 */
export async function reconcileAnalyticsHour(
  db: AnalyticsD1Database,
  hourStart: string,
): Promise<ReconcileAnalyticsHourResult> {
  assertCanonicalUtcHour(hourStart)
  const runId = crypto.randomUUID()

  let started: AnalyticsD1Result[]
  try {
    started = await db.batch([
      db.prepare(START_RECONCILIATION_SQL).bind(runId, hourStart),
    ])
    assertBatchSucceeded(started, 1)
    if (started[0]?.meta?.changes === 0) {
      throw new Error('D1 analytics reconciliation start did not claim the state row')
    }
  } catch {
    throw new Error('D1 analytics reconciliation could not start')
  }

  const statements = [
    db.prepare(DELETE_CONTENT_HOUR_SQL).bind(hourStart),
    db.prepare(REBUILD_CONTENT_HOUR_SQL).bind(hourStart),
    db.prepare(DELETE_CREATOR_HOUR_SQL).bind(hourStart),
    db.prepare(REBUILD_CREATOR_HOUR_SQL).bind(hourStart),
    db.prepare(MARK_HOUR_APPLIED_SQL).bind(hourStart),
    db.prepare(FINALIZE_RECONCILIATION_SQL).bind(hourStart, hourStart, runId),
  ]

  let failureCode: ReconciliationFailureCode = 'REBUILD_FAILED'
  try {
    const results = await db.batch(statements)
    if (results.length !== statements.length) {
      failureCode = 'REBUILD_BATCH_INCOMPLETE'
      throw new Error('unexpected reconciliation result count')
    }
    if (results.some((result) => result.success === false)) {
      throw new Error('reconciliation batch failed')
    }
    if (results[5]?.meta?.changes === 0) {
      failureCode = 'REBUILD_FINALIZE_FAILED'
      throw new Error('reconciliation status finalization did not match the active run')
    }

    return {
      runId,
      hourStart,
      status: 'SUCCEEDED',
      contentBucketsRebuilt: affectedRows(results[1]),
      creatorBucketsRebuilt: affectedRows(results[3]),
    }
  } catch {
    try {
      await db.batch([
        db.prepare(FAIL_RECONCILIATION_SQL).bind(failureCode, runId),
      ])
    } catch {
      // A provider outage may leave RUNNING as the last visible state.
    }
    throw new Error('D1 analytics reconciliation failed')
  }
}
