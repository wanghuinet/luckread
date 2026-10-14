import type { AnalyticsContentType } from './analytics-event-quality'

const MAX_QUERY_WINDOW_MS = 366 * 24 * 60 * 60 * 1000
const CANONICAL_UTC_MILLIS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const CONTENT_METRICS = [
  ['impressions', 'impressions'],
  ['opens', 'opens'],
  ['readStarts', 'read_starts'],
  ['readProgress25', 'read_progress_25'],
  ['readProgress50', 'read_progress_50'],
  ['readProgress75', 'read_progress_75'],
  ['readCompletions', 'read_completions'],
  ['readDurationMs', 'read_duration_ms'],
  ['readDurationEvents', 'read_duration_events'],
  ['dwellDurationMs', 'dwell_duration_ms'],
  ['dwellEvents', 'dwell_events'],
  ['completedViews', 'completed_views'],
  ['videoImpressions', 'video_impressions'],
  ['videoPlayRequests', 'video_play_requests'],
  ['videoPlays', 'video_plays'],
  ['videoProgress25', 'video_progress_25'],
  ['videoProgress50', 'video_progress_50'],
  ['videoProgress75', 'video_progress_75'],
  ['videoProgress90', 'video_progress_90'],
  ['videoCompletions', 'video_completions'],
  ['videoReplays', 'video_replays'],
  ['videoWatchMs', 'video_watch_ms'],
  ['videoWatchEvents', 'video_watch_events'],
  ['likes', 'likes'],
  ['comments', 'comments'],
  ['shares', 'shares'],
  ['favorites', 'favorites'],
] as const

export type ContentAnalyticsMetric = (typeof CONTENT_METRICS)[number][0]

export interface AnalyticsReadStatement {
  bind(...values: (string | number | null)[]): AnalyticsReadStatement
  first(): Promise<Record<string, unknown> | null>
  all(): Promise<{ results?: Record<string, unknown>[] }>
}

export interface AnalyticsReadDatabase {
  prepare(query: string): AnalyticsReadStatement
}

export interface AnalyticsQueryWindow {
  /** Canonical UTC ISO timestamps with millisecond precision. The upper edge is exclusive. */
  from: string
  to: string
}

export interface HourlyBucketWindow {
  /** Requested instants retained for display. */
  from: string
  to: string
  /** Values are whole-hour projections, not event-level exact counts. */
  granularity: 'hour'
  /** Inclusive first UTC hour bucket overlapping the requested window. */
  bucketFrom: string
  /** Exclusive upper UTC hour-bucket boundary. */
  bucketToExclusive: string
}

export interface ContentAnalyticsDerivedMetrics {
  /** Occurrence-count ratios; they may exceed 1 if a producer emits repeated threshold events. Null means denominator is zero. */
  openRate: number | null
  readStartRate: number | null
  readProgress25Rate: number | null
  readProgress50Rate: number | null
  readProgress75Rate: number | null
  readCompletionRate: number | null
  averageReadDwellEventMs: number | null
  averageDwellEventMs: number | null
  completedViewRate: number | null
  videoPlaySuccessRate: number | null
  videoProgress25Rate: number | null
  videoProgress50Rate: number | null
  videoProgress75Rate: number | null
  videoProgress90Rate: number | null
  videoCompletionRate: number | null
  averageVideoWatchEventMs: number | null
  /** Interaction actions per open; can exceed 1 because actions are not unique-user counts. */
  likesPerOpen: number | null
  commentsPerOpen: number | null
  sharesPerOpen: number | null
  favoritesPerOpen: number | null
}

export interface ContentAnalyticsSummary
  extends Record<ContentAnalyticsMetric, number>, HourlyBucketWindow, ContentAnalyticsDerivedMetrics {
  contentId: string
  contentType: AnalyticsContentType
}

export interface ContentAnalyticsMetricChange {
  current: number
  previous: number
  absoluteChange: number
  /** Percentage change; null when the previous period is zero. */
  percentChange: number | null
}

export interface ContentAnalyticsPeriodComparison {
  current: ContentAnalyticsSummary
  previous: ContentAnalyticsSummary
  changes: Record<ContentAnalyticsMetric, ContentAnalyticsMetricChange>
}

export interface CreatorFollowerSummary extends HourlyBucketWindow {
  creatorId: string
  followersGained: number
  followersLost: number
  netFollowers: number
}

export interface ContentAnalyticsRankingRow
  extends Record<ContentAnalyticsMetric, number>, ContentAnalyticsDerivedMetrics {
  rank: number
  contentId: string
  contentType: AnalyticsContentType
}

export interface TopContentAnalyticsResult extends HourlyBucketWindow {
  items: ContentAnalyticsRankingRow[]
}

const MAX_CONTENT_IDS_PER_RANKING_QUERY = 90
const MAX_CONTENT_RANKING_RESULTS = 20

function parseCanonicalInstant(value: string, field: 'from' | 'to'): number {
  if (!CANONICAL_UTC_MILLIS.test(value)) {
    throw new TypeError(`${field} must be a canonical UTC ISO timestamp`)
  }
  const instant = Date.parse(value)
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    throw new TypeError(`${field} must be a real calendar timestamp`)
  }
  return instant
}

function validateWindow(window: AnalyticsQueryWindow): void {
  if (!window || typeof window.from !== 'string' || typeof window.to !== 'string') {
    throw new TypeError('analytics query window must include from and to timestamps')
  }
  const from = parseCanonicalInstant(window.from, 'from')
  const to = parseCanonicalInstant(window.to, 'to')
  if (to <= from) throw new RangeError('analytics query window must be ordered and non-empty')
  if (to - from > MAX_QUERY_WINDOW_MS) {
    throw new RangeError('analytics query window cannot exceed 366 days')
  }
}

function getHourlyBucketWindow(window: AnalyticsQueryWindow): HourlyBucketWindow {
  const fromMs = Date.parse(window.from)
  const toMs = Date.parse(window.to)
  const hourMs = 60 * 60 * 1000
  const bucketFrom = new Date(Math.floor(fromMs / hourMs) * hourMs).toISOString()
  const bucketToExclusive = new Date(
    Math.ceil(toMs / hourMs) * hourMs,
  ).toISOString()
  return {
    from: window.from,
    to: window.to,
    granularity: 'hour',
    bucketFrom,
    bucketToExclusive,
  }
}

function validateIdentifier(value: string, field: 'contentId' | 'creatorId'): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${field} is invalid`)
  }
}

function readCount(row: Record<string, unknown> | null, column: string): number {
  const value = row?.[column] ?? 0
  const count =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`analytics query returned an invalid count for ${column}`)
  }
  return count
}

function readContentMetrics(
  row: Record<string, unknown> | null,
): Record<ContentAnalyticsMetric, number> {
  return Object.fromEntries(
    CONTENT_METRICS.map(([key]) => [key, readCount(row, key)]),
  ) as Record<ContentAnalyticsMetric, number>
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function deriveContentMetrics(
  metrics: Record<ContentAnalyticsMetric, number>,
): ContentAnalyticsDerivedMetrics {
  return {
    openRate: ratio(metrics.opens, metrics.impressions),
    readStartRate: ratio(metrics.readStarts, metrics.opens),
    readProgress25Rate: ratio(metrics.readProgress25, metrics.readStarts),
    readProgress50Rate: ratio(metrics.readProgress50, metrics.readStarts),
    readProgress75Rate: ratio(metrics.readProgress75, metrics.readStarts),
    readCompletionRate: ratio(metrics.readCompletions, metrics.readStarts),
    averageReadDwellEventMs: ratio(metrics.readDurationMs, metrics.readDurationEvents),
    averageDwellEventMs: ratio(metrics.dwellDurationMs, metrics.dwellEvents),
    completedViewRate: ratio(metrics.completedViews, metrics.opens),
    videoPlaySuccessRate: ratio(metrics.videoPlays, metrics.videoPlayRequests),
    videoProgress25Rate: ratio(metrics.videoProgress25, metrics.videoPlays),
    videoProgress50Rate: ratio(metrics.videoProgress50, metrics.videoPlays),
    videoProgress75Rate: ratio(metrics.videoProgress75, metrics.videoPlays),
    videoProgress90Rate: ratio(metrics.videoProgress90, metrics.videoPlays),
    videoCompletionRate: ratio(metrics.videoCompletions, metrics.videoPlays),
    averageVideoWatchEventMs: ratio(metrics.videoWatchMs, metrics.videoWatchEvents),
    likesPerOpen: ratio(metrics.likes, metrics.opens),
    commentsPerOpen: ratio(metrics.comments, metrics.opens),
    sharesPerOpen: ratio(metrics.shares, metrics.opens),
    favoritesPerOpen: ratio(metrics.favorites, metrics.opens),
  }
}

function buildTopContentSql(
  contentIdCount: number,
  rankBy: ContentAnalyticsMetric,
): string {
  const columns = CONTENT_METRICS.map(
    ([key, column]) => `COALESCE(SUM(${column}), 0) AS ${key}`,
  ).join(',\n  ')
  const rankAlias = CONTENT_METRICS.find(([key]) => key === rankBy)?.[0]
  if (!rankAlias) throw new TypeError('rankBy is invalid')
  const orderBy = [
    `${rankAlias} DESC`,
    ...(rankBy === 'opens' ? [] : ['opens DESC']),
    ...(rankBy === 'impressions' ? [] : ['impressions DESC']),
    'content_id ASC',
    'content_type ASC',
  ].join(', ')
  const placeholders = Array.from({ length: contentIdCount }, () => '?').join(', ')
  return `SELECT
  content_id AS contentId,
  content_type AS contentType,
  ${columns}
FROM analytics_content_hourly
WHERE content_id IN (${placeholders})
  AND hour_start >= ?
  AND hour_start < ?
  AND metric_version = ?
GROUP BY content_id, content_type
ORDER BY ${orderBy}
LIMIT ?`
}

function buildContentSummarySql(): string {
  const columns = CONTENT_METRICS.map(
    ([key, column]) => `COALESCE(SUM(${column}), 0) AS ${key}`,
  ).join(',\n  ')
  return `SELECT
  ${columns}
FROM analytics_content_hourly
WHERE content_id = ?
  AND content_type = ?
  AND hour_start >= ?
  AND hour_start < ?
  AND metric_version = ?`
}

const CONTENT_SUMMARY_SQL = buildContentSummarySql()

const CONTENT_COMPARISON_COLUMNS = CONTENT_METRICS.flatMap(([key, column]) => [
  `COALESCE(SUM(CASE WHEN hour_start >= periods.current_from AND hour_start < periods.current_to THEN ${column} ELSE 0 END), 0) AS current_${key}`,
  `COALESCE(SUM(CASE WHEN hour_start >= periods.previous_from AND hour_start < periods.previous_to THEN ${column} ELSE 0 END), 0) AS previous_${key}`,
]).join(',\\n  ')

const CONTENT_COMPARISON_SQL = `WITH periods AS (
  SELECT ? AS current_from, ? AS current_to, ? AS previous_from, ? AS previous_to
)
SELECT
  ${CONTENT_COMPARISON_COLUMNS}
FROM analytics_content_hourly
CROSS JOIN periods
WHERE content_id = ?
  AND content_type = ?
  AND metric_version = ?
  AND (
    (hour_start >= periods.current_from AND hour_start < periods.current_to)
    OR
    (hour_start >= periods.previous_from AND hour_start < periods.previous_to)
  )`

const CREATOR_FOLLOWER_SUMMARY_SQL = `SELECT
  COALESCE(SUM(followers_gained), 0) AS followersGained,
  COALESCE(SUM(followers_lost), 0) AS followersLost
FROM analytics_creator_hourly
WHERE creator_id = ?
  AND hour_start >= ?
  AND hour_start < ?
  AND metric_version = ?`

/**
 * Read pre-aggregated content metrics for one content item and bounded period.
 * Results include every UTC hourly bucket overlapping [from, to); they are not
 * event-level exact counts for partial hours. The caller must enforce authorization.
 * This query module itself deliberately has no HTTP or identity-provider behavior.
 */
export async function getContentAnalyticsSummary(
  db: AnalyticsReadDatabase,
  input: {
    contentId: string
    contentType: AnalyticsContentType
    window: AnalyticsQueryWindow
  },
): Promise<ContentAnalyticsSummary> {
  validateIdentifier(input.contentId, 'contentId')
  if (!['article', 'post', 'video'].includes(input.contentType)) {
    throw new TypeError('contentType is invalid')
  }
  validateWindow(input.window)
  const bucketWindow = getHourlyBucketWindow(input.window)

  const row = await db
    .prepare(CONTENT_SUMMARY_SQL)
    .bind(
      input.contentId,
      input.contentType,
      bucketWindow.bucketFrom,
      bucketWindow.bucketToExclusive,
      '1.0',
    )
    .first()

  const metrics = readContentMetrics(row)

  return {
    contentId: input.contentId,
    contentType: input.contentType,
    ...bucketWindow,
    ...metrics,
    ...deriveContentMetrics(metrics),
  }
}

/**
 * Compare two non-overlapping content analytics periods in one bounded D1 query.
 *
 * Metric values are based on whole hourly buckets overlapping each requested
 * window. Current and previous buckets must not overlap, otherwise a bucket
 * could be counted twice. A zero previous value yields a null percent change.
 */
export async function getContentAnalyticsPeriodComparison(
  db: AnalyticsReadDatabase,
  input: {
    contentId: string
    contentType: AnalyticsContentType
    currentWindow: AnalyticsQueryWindow
    previousWindow: AnalyticsQueryWindow
  },
): Promise<ContentAnalyticsPeriodComparison> {
  validateIdentifier(input.contentId, 'contentId')
  if (!['article', 'post', 'video'].includes(input.contentType)) {
    throw new TypeError('contentType is invalid')
  }
  validateWindow(input.currentWindow)
  validateWindow(input.previousWindow)

  const currentBucketWindow = getHourlyBucketWindow(input.currentWindow)
  const previousBucketWindow = getHourlyBucketWindow(input.previousWindow)
  if (
    Date.parse(previousBucketWindow.bucketToExclusive) >
    Date.parse(currentBucketWindow.bucketFrom)
  ) {
    throw new RangeError(
      'previous period buckets must end before current period buckets begin',
    )
  }

  const row = await db
    .prepare(CONTENT_COMPARISON_SQL)
    .bind(
      currentBucketWindow.bucketFrom,
      currentBucketWindow.bucketToExclusive,
      previousBucketWindow.bucketFrom,
      previousBucketWindow.bucketToExclusive,
      input.contentId,
      input.contentType,
      '1.0',
    )
    .first()

  const currentMetrics = Object.fromEntries(
    CONTENT_METRICS.map(([key]) => [
      key,
      readCount(row, `current_${key}`),
    ]),
  ) as Record<ContentAnalyticsMetric, number>
  const previousMetrics = Object.fromEntries(
    CONTENT_METRICS.map(([key]) => [
      key,
      readCount(row, `previous_${key}`),
    ]),
  ) as Record<ContentAnalyticsMetric, number>

  const changes = Object.fromEntries(
    CONTENT_METRICS.map(([key]) => {
      const current = currentMetrics[key]
      const previous = previousMetrics[key]
      const absoluteChange = current - previous
      return [
        key,
        {
          current,
          previous,
          absoluteChange,
          percentChange: previous === 0 ? null : (absoluteChange / previous) * 100,
        },
      ]
    }),
  ) as Record<ContentAnalyticsMetric, ContentAnalyticsMetricChange>

  return {
    current: {
      contentId: input.contentId,
      contentType: input.contentType,
      ...currentBucketWindow,
      ...currentMetrics,
      ...deriveContentMetrics(currentMetrics),
    },
    previous: {
      contentId: input.contentId,
      contentType: input.contentType,
      ...previousBucketWindow,
      ...previousMetrics,
      ...deriveContentMetrics(previousMetrics),
    },
    changes,
  }
}

/**
 * Rank a caller-supplied, already-authorized set of content IDs using derived
 * hourly metrics. The caller must obtain/authorize IDs through W03 first.
 * This function deliberately does not resolve creator ownership or expose HTTP.
 */
export async function getTopContentAnalyticsForContentSet(
  db: AnalyticsReadDatabase,
  input: {
    contentIds: readonly string[]
    window: AnalyticsQueryWindow
    limit?: number
    /** Metric to rank by; defaults to opens for backward compatibility. */
    rankBy?: ContentAnalyticsMetric
  },
): Promise<TopContentAnalyticsResult> {
  validateWindow(input.window)
  const rankBy = input.rankBy ?? 'opens'
  if (!CONTENT_METRICS.some(([key]) => key === rankBy)) {
    throw new TypeError('rankBy is invalid')
  }
  if (!Array.isArray(input.contentIds)) {
    throw new TypeError('contentIds must be an array')
  }
  if (input.contentIds.length > MAX_CONTENT_IDS_PER_RANKING_QUERY) {
    throw new RangeError(
      `contentIds cannot exceed ${MAX_CONTENT_IDS_PER_RANKING_QUERY} items per query`,
    )
  }

  const limit = input.limit ?? 10
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_CONTENT_RANKING_RESULTS
  ) {
    throw new RangeError(
      `limit must be an integer between 1 and ${MAX_CONTENT_RANKING_RESULTS}`,
    )
  }

  const contentIds = [...new Set(input.contentIds)]
  for (const contentId of contentIds) validateIdentifier(contentId, 'contentId')
  const bucketWindow = getHourlyBucketWindow(input.window)

  if (contentIds.length === 0) return { ...bucketWindow, items: [] }

  const statement = db
    .prepare(buildTopContentSql(contentIds.length, rankBy))
    .bind(
      ...contentIds,
      bucketWindow.bucketFrom,
      bucketWindow.bucketToExclusive,
      '1.0',
      limit,
    )
  const result = await statement.all()
  const items = (result.results ?? []).map((row, index): ContentAnalyticsRankingRow => {
    const contentId = row.contentId
    const contentType = row.contentType
    if (typeof contentId !== 'string') {
      throw new TypeError('analytics ranking returned an invalid contentId')
    }
    validateIdentifier(contentId, 'contentId')
    if (contentType !== 'article' && contentType !== 'post' && contentType !== 'video') {
      throw new TypeError('analytics ranking returned an invalid contentType')
    }
    const metrics = readContentMetrics(row)
    return {
      rank: index + 1,
      contentId,
      contentType,
      ...metrics,
      ...deriveContentMetrics(metrics),
    }
  })

  return { ...bucketWindow, items }
}

/**
 * Read creator follower deltas from the derived hourly projection. Results
 * include whole hourly buckets overlapping the requested window. A net value
 * is a period delta (gained minus lost), not an authoritative current follower
 * count; W05 remains the source of truth for the relationship graph.
 */
export async function getCreatorFollowerSummary(
  db: AnalyticsReadDatabase,
  input: {
    creatorId: string
    window: AnalyticsQueryWindow
  },
): Promise<CreatorFollowerSummary> {
  validateIdentifier(input.creatorId, 'creatorId')
  validateWindow(input.window)
  const bucketWindow = getHourlyBucketWindow(input.window)

  const row = await db
    .prepare(CREATOR_FOLLOWER_SUMMARY_SQL)
    .bind(
      input.creatorId,
      bucketWindow.bucketFrom,
      bucketWindow.bucketToExclusive,
      '1.0',
    )
    .first()

  const followersGained = readCount(row, 'followersGained')
  const followersLost = readCount(row, 'followersLost')
  return {
    creatorId: input.creatorId,
    ...bucketWindow,
    followersGained,
    followersLost,
    netFollowers: followersGained - followersLost,
  }
}
