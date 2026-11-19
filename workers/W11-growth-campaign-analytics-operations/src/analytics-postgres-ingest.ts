import { ANALYTICS_METRIC_VERSION } from './analytics-aggregation'
import {
  ANALYTICS_MAX_BATCH_SIZE,
  type AnalyticsEvent,
} from './analytics-event-quality'
import type { AnalyticsPostgresPool } from './analytics-postgres-store'

export interface PersistAnalyticsPostgresBatchResult {
  attempted: number
  inserted: number
  duplicates: number
  duplicateEventIds: string[]
  lateAttempted: number
  lateInserted: number
  lateDuplicates: number
  lateDuplicateEventIds: string[]
}

const INSERT_SQL = String.raw`
  INSERT INTO analytics_event_dedupe (
    event_id, dedupe_key, schema_version, event_name, source_worker,
    occurred_at, received_at, hour_start, actor_type, content_id,
    content_type, creator_id, duration_ms, position, metric_version,
    projection_status
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
  )
  ON CONFLICT DO NOTHING
  RETURNING event_id
`

const CONTENT_PROJECTION_SQL = String.raw`
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
WHERE projection_status = 'PENDING'
  AND event_name NOT IN ('follow_created', 'follow_removed')
GROUP BY hour_start, content_type, content_id, metric_version
ON CONFLICT (hour_start, content_type, content_id, metric_version) DO UPDATE SET
  impressions = analytics_content_hourly.impressions + excluded.impressions,
  opens = analytics_content_hourly.opens + excluded.opens,
  read_starts = analytics_content_hourly.read_starts + excluded.read_starts,
  read_progress_25 = analytics_content_hourly.read_progress_25 + excluded.read_progress_25,
  read_progress_50 = analytics_content_hourly.read_progress_50 + excluded.read_progress_50,
  read_progress_75 = analytics_content_hourly.read_progress_75 + excluded.read_progress_75,
  read_completions = analytics_content_hourly.read_completions + excluded.read_completions,
  read_duration_ms = analytics_content_hourly.read_duration_ms + excluded.read_duration_ms,
  read_duration_events = analytics_content_hourly.read_duration_events + excluded.read_duration_events,
  dwell_duration_ms = analytics_content_hourly.dwell_duration_ms + excluded.dwell_duration_ms,
  dwell_events = analytics_content_hourly.dwell_events + excluded.dwell_events,
  completed_views = analytics_content_hourly.completed_views + excluded.completed_views,
  video_impressions = analytics_content_hourly.video_impressions + excluded.video_impressions,
  video_play_requests = analytics_content_hourly.video_play_requests + excluded.video_play_requests,
  video_plays = analytics_content_hourly.video_plays + excluded.video_plays,
  video_progress_25 = analytics_content_hourly.video_progress_25 + excluded.video_progress_25,
  video_progress_50 = analytics_content_hourly.video_progress_50 + excluded.video_progress_50,
  video_progress_75 = analytics_content_hourly.video_progress_75 + excluded.video_progress_75,
  video_progress_90 = analytics_content_hourly.video_progress_90 + excluded.video_progress_90,
  video_completions = analytics_content_hourly.video_completions + excluded.video_completions,
  video_replays = analytics_content_hourly.video_replays + excluded.video_replays,
  video_watch_ms = analytics_content_hourly.video_watch_ms + excluded.video_watch_ms,
  video_watch_events = analytics_content_hourly.video_watch_events + excluded.video_watch_events,
  likes = analytics_content_hourly.likes + excluded.likes,
  comments = analytics_content_hourly.comments + excluded.comments,
  shares = analytics_content_hourly.shares + excluded.shares,
  favorites = analytics_content_hourly.favorites + excluded.favorites
`

const CREATOR_PROJECTION_SQL = String.raw`
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
WHERE projection_status = 'PENDING'
  AND event_name IN ('follow_created', 'follow_removed')
GROUP BY hour_start, creator_id, metric_version
ON CONFLICT (hour_start, creator_id, metric_version) DO UPDATE SET
  followers_gained = analytics_creator_hourly.followers_gained + excluded.followers_gained,
  followers_lost = analytics_creator_hourly.followers_lost + excluded.followers_lost
`

const MARK_APPLIED_SQL = String.raw`
UPDATE analytics_event_dedupe
SET projection_status = 'APPLIED'
WHERE projection_status = 'PENDING'
`

function eventValues(
  event: AnalyticsEvent,
  projectionStatus: 'PENDING' | 'LATE',
): (string | number | null)[] {
  const occurredAt = Date.parse(event.occurredAt)
  if (!Number.isFinite(occurredAt)) {
    throw new TypeError('Accepted analytics events must have a valid occurredAt')
  }
  const hour = new Date(occurredAt)
  hour.setUTCMinutes(0, 0, 0)
  return [
    event.eventId,
    event.dedupeKey,
    event.schemaVersion,
    event.eventName,
    event.sourceWorker,
    event.occurredAt,
    event.receivedAt,
    hour.toISOString(),
    event.actorType,
    event.contentId ?? null,
    event.contentType ?? null,
    event.creatorId ?? null,
    event.durationMs ?? null,
    event.position ?? null,
    ANALYTICS_METRIC_VERSION,
    projectionStatus,
  ]
}

/**
 * Inserts event facts and updates all pending projections inside one PostgreSQL
 * transaction. The transaction advisory lock preserves the single-writer
 * projection invariant when multiple W11 isolates ingest concurrently.
 */
export async function persistAnalyticsEventsPostgres(
  pool: AnalyticsPostgresPool,
  events: readonly AnalyticsEvent[],
  lateEvents: readonly AnalyticsEvent[] = [],
): Promise<PersistAnalyticsPostgresBatchResult> {
  const total = events.length + lateEvents.length
  if (total > ANALYTICS_MAX_BATCH_SIZE) {
    throw new RangeError(`batch exceeds the ${ANALYTICS_MAX_BATCH_SIZE}-event limit`)
  }

  const empty: PersistAnalyticsPostgresBatchResult = {
    attempted: 0, inserted: 0, duplicates: 0, duplicateEventIds: [],
    lateAttempted: 0, lateInserted: 0, lateDuplicates: 0, lateDuplicateEventIds: [],
  }
  if (total === 0) return empty

  const client = await pool.connect()
  let transactionStarted = false
  const duplicateEventIds: string[] = []
  const lateDuplicateEventIds: string[] = []
  let inserted = 0
  let lateInserted = 0

  try {
    await client.query('BEGIN')
    transactionStarted = true
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('luckread:w11:analytics-projection'))",
    )

    for (const event of events) {
      const result = await client.query<{ event_id: string }>(INSERT_SQL, eventValues(event, 'PENDING'))
      if (result.rows.length === 1) inserted += 1
      else duplicateEventIds.push(event.eventId)
    }
    for (const event of lateEvents) {
      const result = await client.query<{ event_id: string }>(INSERT_SQL, eventValues(event, 'LATE'))
      if (result.rows.length === 1) lateInserted += 1
      else lateDuplicateEventIds.push(event.eventId)
    }

    if (events.length > 0) {
      await client.query(CONTENT_PROJECTION_SQL)
      await client.query(CREATOR_PROJECTION_SQL)
      await client.query(MARK_APPLIED_SQL)
    }

    await client.query('COMMIT')
    transactionStarted = false
    return {
      attempted: events.length,
      inserted,
      duplicates: duplicateEventIds.length,
      duplicateEventIds,
      lateAttempted: lateEvents.length,
      lateInserted,
      lateDuplicates: lateDuplicateEventIds.length,
      lateDuplicateEventIds,
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original transaction failure.
      }
    }
    throw error
  } finally {
    client.release()
  }
}
