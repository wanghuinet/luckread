import type {
  AnalyticsBatchResult,
  AnalyticsContentType,
  AnalyticsEvent,
} from './analytics-event-quality'

export const ANALYTICS_METRIC_VERSION = '1.0' as const
export const ANALYTICS_AGGREGATION_WINDOW = 'hour' as const

export interface ContentHourlyProjection {
  metricVersion: typeof ANALYTICS_METRIC_VERSION
  aggregationWindow: typeof ANALYTICS_AGGREGATION_WINDOW
  hourStart: string
  contentId: string
  contentType: AnalyticsContentType
  impressions: number
  opens: number
  readStarts: number
  readProgress25: number
  readProgress50: number
  readProgress75: number
  readCompletions: number
  readDurationMs: number
  readDurationEvents: number
  dwellDurationMs: number
  dwellEvents: number
  completedViews: number
  videoImpressions: number
  videoPlayRequests: number
  videoPlays: number
  videoProgress25: number
  videoProgress50: number
  videoProgress75: number
  videoProgress90: number
  videoCompletions: number
  videoReplays: number
  videoWatchMs: number
  videoWatchEvents: number
  likes: number
  comments: number
  shares: number
  favorites: number
}

export interface CreatorHourlyProjection {
  metricVersion: typeof ANALYTICS_METRIC_VERSION
  aggregationWindow: typeof ANALYTICS_AGGREGATION_WINDOW
  hourStart: string
  creatorId: string
  followersGained: number
  followersLost: number
}

export interface AnalyticsAggregationResult {
  contentHourly: ContentHourlyProjection[]
  creatorHourly: CreatorHourlyProjection[]
}

function hourStartForEvent(event: AnalyticsEvent): string {
  const occurredAt = Date.parse(event.occurredAt)
  if (!Number.isFinite(occurredAt)) {
    throw new TypeError('Accepted analytics events must have a valid occurredAt')
  }

  const hour = new Date(occurredAt)
  hour.setUTCMinutes(0, 0, 0)
  return hour.toISOString()
}

function newContentProjection(
  hourStart: string,
  contentId: string,
  contentType: AnalyticsContentType,
): ContentHourlyProjection {
  return {
    metricVersion: ANALYTICS_METRIC_VERSION,
    aggregationWindow: ANALYTICS_AGGREGATION_WINDOW,
    hourStart,
    contentId,
    contentType,
    impressions: 0,
    opens: 0,
    readStarts: 0,
    readProgress25: 0,
    readProgress50: 0,
    readProgress75: 0,
    readCompletions: 0,
    readDurationMs: 0,
    readDurationEvents: 0,
    dwellDurationMs: 0,
    dwellEvents: 0,
    completedViews: 0,
    videoImpressions: 0,
    videoPlayRequests: 0,
    videoPlays: 0,
    videoProgress25: 0,
    videoProgress50: 0,
    videoProgress75: 0,
    videoProgress90: 0,
    videoCompletions: 0,
    videoReplays: 0,
    videoWatchMs: 0,
    videoWatchEvents: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    favorites: 0,
  }
}

function newCreatorProjection(
  hourStart: string,
  creatorId: string,
): CreatorHourlyProjection {
  return {
    metricVersion: ANALYTICS_METRIC_VERSION,
    aggregationWindow: ANALYTICS_AGGREGATION_WINDOW,
    hourStart,
    creatorId,
    followersGained: 0,
    followersLost: 0,
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareContentProjection(
  left: ContentHourlyProjection,
  right: ContentHourlyProjection,
): number {
  return (
    compareText(left.hourStart, right.hourStart) ||
    compareText(left.contentType, right.contentType) ||
    compareText(left.contentId, right.contentId)
  )
}

function compareCreatorProjection(
  left: CreatorHourlyProjection,
  right: CreatorHourlyProjection,
): number {
  return (
    compareText(left.hourStart, right.hourStart) ||
    compareText(left.creatorId, right.creatorId)
  )
}

/**
 * Build rebuildable hourly projections from validated events only.
 *
 * This function is deliberately pure: it performs no D1 writes, network calls,
 * cache changes, or mutations to the input batch. The persistence adapter must
 * upsert these derived projections in a separate async processing step.
 */
export function aggregateAnalyticsBatch(
  batch: Pick<AnalyticsBatchResult, 'accepted'>,
): AnalyticsAggregationResult {
  const content = new Map<string, ContentHourlyProjection>()
  const creators = new Map<string, CreatorHourlyProjection>()

  for (const event of batch.accepted) {
    const hourStart = hourStartForEvent(event)

    if (event.eventName === 'follow_created' || event.eventName === 'follow_removed') {
      if (!event.creatorId) {
        throw new TypeError('Accepted follow events must include creatorId')
      }
      const key = JSON.stringify([hourStart, event.creatorId])
      let projection = creators.get(key)
      if (!projection) {
        projection = newCreatorProjection(hourStart, event.creatorId)
        creators.set(key, projection)
      }
      if (event.eventName === 'follow_created') projection.followersGained += 1
      else projection.followersLost += 1
      continue
    }

    if (!event.contentId || !event.contentType) {
      throw new TypeError(
        'Accepted content analytics events must include contentId and contentType',
      )
    }

    const key = JSON.stringify([hourStart, event.contentType, event.contentId])
    let projection = content.get(key)
    if (!projection) {
      projection = newContentProjection(hourStart, event.contentId, event.contentType)
      content.set(key, projection)
    }

    switch (event.eventName) {
      case 'content_impression':
        projection.impressions += 1
        break
      case 'content_open':
        projection.opens += 1
        break
      case 'read_start':
        projection.readStarts += 1
        break
      case 'read_progress_25':
        projection.readProgress25 += 1
        break
      case 'read_progress_50':
        projection.readProgress50 += 1
        break
      case 'read_progress_75':
        projection.readProgress75 += 1
        break
      case 'read_complete':
        projection.readCompletions += 1
        break
      case 'read_dwell':
        projection.readDurationMs += event.durationMs ?? 0
        projection.readDurationEvents += 1
        break
      case 'dwell':
        projection.dwellDurationMs += event.durationMs ?? 0
        projection.dwellEvents += 1
        break
      case 'complete_view':
        projection.completedViews += 1
        break
      case 'video_impression':
        projection.videoImpressions += 1
        break
      case 'video_play_request':
        projection.videoPlayRequests += 1
        break
      case 'video_play_success':
        projection.videoPlays += 1
        break
      case 'video_progress_25':
        projection.videoProgress25 += 1
        break
      case 'video_progress_50':
        projection.videoProgress50 += 1
        break
      case 'video_progress_75':
        projection.videoProgress75 += 1
        break
      case 'video_progress_90':
        projection.videoProgress90 += 1
        break
      case 'video_complete':
        projection.videoCompletions += 1
        break
      case 'video_replay':
        projection.videoReplays += 1
        break
      case 'video_watch':
        projection.videoWatchMs += event.durationMs ?? 0
        projection.videoWatchEvents += 1
        break
      case 'like_created':
        projection.likes += 1
        break
      case 'comment_created':
        projection.comments += 1
        break
      case 'share_created':
        projection.shares += 1
        break
      case 'favorite_created':
        projection.favorites += 1
        break
      default:
        throw new TypeError('Unsupported analytics event for aggregation')
    }
  }

  return {
    contentHourly: [...content.values()].sort(compareContentProjection),
    creatorHourly: [...creators.values()].sort(compareCreatorProjection),
  }
}
