import { ANALYTICS_METRIC_VERSION } from './analytics-aggregation'
import {
  ANALYTICS_MAX_BATCH_SIZE,
  type AnalyticsEvent,
} from './analytics-event-quality'

/** Narrow structural types keep tests independent of a live Cloudflare account. */
export interface AnalyticsD1Result {
  success?: boolean
  error?: string
  meta?: {
    changes?: number
  }
}

export interface AnalyticsD1PreparedStatement {
  bind(...values: (string | number | null)[]): AnalyticsD1PreparedStatement
}

export interface AnalyticsD1Database {
  prepare(query: string): AnalyticsD1PreparedStatement
  /** D1 batch is one transaction; a failed statement rolls back the whole batch. */
  batch(statements: AnalyticsD1PreparedStatement[]): Promise<AnalyticsD1Result[]>
}

export interface PersistAnalyticsBatchResult {
  attempted: number
  inserted: number
  duplicates: number
  /** Event IDs ignored by D1 because their event ID or dedupe key already existed. */
  duplicateEventIds: string[]
}

const INSERT_COLUMNS = [
  'event_id',
  'dedupe_key',
  'schema_version',
  'event_name',
  'source_worker',
  'occurred_at',
  'received_at',
  'hour_start',
  'actor_type',
  'content_id',
  'content_type',
  'creator_id',
  'duration_ms',
  'position',
  'metric_version',
  'projection_status',
] as const

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

function hourStartForEvent(event: AnalyticsEvent): string {
  const occurredAt = Date.parse(event.occurredAt)
  if (!Number.isFinite(occurredAt)) {
    throw new TypeError('Accepted analytics events must have a valid occurredAt')
  }

  const hour = new Date(occurredAt)
  hour.setUTCMinutes(0, 0, 0)
  return hour.toISOString()
}

function bindValues(event: AnalyticsEvent): (string | number | null)[] {
  // Actor IDs, visitor IDs and session IDs are intentionally not persisted in
  // this projection store. D1-05 stores aggregate-ready event facts, not identity.
  return [
    event.eventId,
    event.dedupeKey,
    event.schemaVersion,
    event.eventName,
    event.sourceWorker,
    event.occurredAt,
    event.receivedAt,
    hourStartForEvent(event),
    event.actorType,
    event.contentId ?? null,
    event.contentType ?? null,
    event.creatorId ?? null,
    event.durationMs ?? null,
    event.position ?? null,
    ANALYTICS_METRIC_VERSION,
    'PENDING',
  ]
}

/**
 * Persist only events already accepted by processAnalyticsBatch.
 *
 * Four statements execute in one D1 transaction: insert unique events, aggregate
 * all pending rows by hour/content (not one hot-counter UPDATE per event),
 * aggregate creator follow changes, then mark processed rows. A failure rolls
 * all four operations back, so retrying cannot lose or double-apply projections.
 */
export async function persistAnalyticsEvents(
  db: AnalyticsD1Database,
  events: readonly AnalyticsEvent[],
): Promise<PersistAnalyticsBatchResult> {
  if (events.length > ANALYTICS_MAX_BATCH_SIZE) {
    throw new RangeError(
      `batch exceeds the ${ANALYTICS_MAX_BATCH_SIZE}-event limit`,
    )
  }

  if (events.length === 0) {
    return { attempted: 0, inserted: 0, duplicates: 0, duplicateEventIds: [] }
  }

  const placeholders = INSERT_COLUMNS.map(() => '?').join(', ')
  const insertSql = `INSERT INTO analytics_event_dedupe (${INSERT_COLUMNS.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  const insertStatements = events.map((event) =>
    db.prepare(insertSql).bind(...bindValues(event)),
  )

  // D1 allows at most 100 bound parameters per query. Keep inserts separate
  // (16 bound fields each) and cap this transaction at 90 inserts plus the three
  // grouped projection/finalization statements (93 statements total).
  const results = await db.batch([
    ...insertStatements,
    db.prepare(CONTENT_PROJECTION_SQL),
    db.prepare(CREATOR_PROJECTION_SQL),
    db.prepare(MARK_APPLIED_SQL),
  ])

  if (results.length !== events.length + 3) {
    throw new Error('D1 analytics transaction returned an unexpected result count')
  }
  const failed = results.find((result) => result.success === false)
  if (failed) {
    throw new Error(failed.error || 'D1 analytics transaction failed')
  }

  let inserted = 0
  const duplicateEventIds: string[] = []
  for (const [index, result] of results.slice(0, events.length).entries()) {
    const changes = result.meta?.changes
    if (changes !== 0 && changes !== 1) {
      throw new Error('D1 analytics insert did not return a valid changes count')
    }
    if (changes === 1) {
      inserted += 1
    } else {
      const duplicateId = events[index]?.eventId
      if (!duplicateId) {
        throw new Error('D1 analytics duplicate could not be correlated to an event ID')
      }
      duplicateEventIds.push(duplicateId)
    }
  }

  return {
    attempted: events.length,
    inserted,
    duplicates: duplicateEventIds.length,
    duplicateEventIds,
  }
}
