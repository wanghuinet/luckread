import { describe, expect, it } from 'vitest'
import {
  aggregateAnalyticsBatch,
  type ContentHourlyProjection,
} from './analytics-aggregation'
import {
  processAnalyticsBatch,
  type AnalyticsEvent,
} from './analytics-event-quality'

const now = Date.parse('2026-10-14T00:30:00.000Z')
const occurredAt = '2026-10-14T00:12:00.000Z'

function event(
  eventId: string,
  eventName: AnalyticsEvent['eventName'],
  overrides: Record<string, unknown> = {},
): AnalyticsEvent {
  const isSocial =
    eventName === 'like_created' ||
    eventName === 'comment_created' ||
    eventName === 'share_created' ||
    eventName === 'favorite_created' ||
    eventName === 'follow_created' ||
    eventName === 'follow_removed'

  return {
    eventId,
    schemaVersion: '1.0',
    eventName,
    sourceWorker: isSocial ? 'W05' : 'W03',
    occurredAt,
    receivedAt: occurredAt,
    dedupeKey: `dedupe_${eventId}`,
    actorType: 'user',
    actorId: 'user_0001',
    sessionId: 'session_001',
    contentId: 'content_01',
    contentType: 'article',
    ...overrides,
  } as AnalyticsEvent
}

function byContentType(
  rows: ContentHourlyProjection[],
  contentType: ContentHourlyProjection['contentType'],
): ContentHourlyProjection | undefined {
  return rows.find((row) => row.contentType === contentType)
}

describe('W11 analytics aggregation', () => {
  it('builds hourly article read and engagement projections from accepted events', () => {
    const batch = processAnalyticsBatch(
      [
        event('evt_000001', 'content_impression'),
        event('evt_000002', 'content_open'),
        event('evt_000003', 'read_start'),
        event('evt_000004', 'read_progress_25'),
        event('evt_000005', 'read_complete'),
        event('evt_000006', 'read_dwell', { durationMs: 12_000 }),
        event('evt_000007', 'like_created'),
        event('evt_000008', 'comment_created'),
        event('evt_000009', 'share_created'),
        event('evt_000010', 'favorite_created'),
      ],
      { now },
    )

    const result = aggregateAnalyticsBatch(batch)
    const article = byContentType(result.contentHourly, 'article')

    expect(article).toMatchObject({
      hourStart: '2026-10-14T00:00:00.000Z',
      metricVersion: '1.0',
      aggregationWindow: 'hour',
      contentId: 'content_01',
      impressions: 1,
      opens: 1,
      readStarts: 1,
      readProgress25: 1,
      readCompletions: 1,
      readDurationMs: 12_000,
      readDurationEvents: 1,
      likes: 1,
      comments: 1,
      shares: 1,
      favorites: 1,
    })
    expect(result.creatorHourly).toEqual([])
  })

  it('aggregates video milestones, replays, and watch-duration sums', () => {
    const batch = processAnalyticsBatch(
      [
        event('evt_000011', 'video_impression', { contentType: 'video' }),
        event('evt_000012', 'video_play_request', { contentType: 'video' }),
        event('evt_000013', 'video_play_success', { contentType: 'video' }),
        event('evt_000014', 'video_progress_25', { contentType: 'video' }),
        event('evt_000015', 'video_progress_50', { contentType: 'video' }),
        event('evt_000016', 'video_progress_75', { contentType: 'video' }),
        event('evt_000017', 'video_progress_90', { contentType: 'video' }),
        event('evt_000018', 'video_complete', { contentType: 'video' }),
        event('evt_000019', 'video_replay', { contentType: 'video' }),
        event('evt_000020', 'video_watch', {
          contentType: 'video',
          durationMs: 8_000,
        }),
        event('evt_000021', 'video_watch', {
          contentType: 'video',
          durationMs: 5_000,
        }),
      ],
      { now },
    )

    const result = aggregateAnalyticsBatch(batch)
    const video = byContentType(result.contentHourly, 'video')

    expect(video).toMatchObject({
      videoImpressions: 1,
      videoPlayRequests: 1,
      videoPlays: 1,
      videoProgress25: 1,
      videoProgress50: 1,
      videoProgress75: 1,
      videoProgress90: 1,
      videoCompletions: 1,
      videoReplays: 1,
      videoWatchMs: 13_000,
      videoWatchEvents: 2,
    })
  })

  it('keeps separate projections for content ids, types, and UTC hours', () => {
    const batch = processAnalyticsBatch(
      [
        event('evt_000022', 'content_open', {
          occurredAt: '2026-10-14T00:59:00-07:00',
          receivedAt: '2026-10-14T00:59:00-07:00',
          contentId: 'content_02',
        }),
        event('evt_000023', 'content_open', {
          occurredAt: '2026-10-14T01:05:00.000Z',
          receivedAt: '2026-10-14T01:05:00.000Z',
          contentId: 'content_01',
        }),
        event('evt_000024', 'content_open', {
          contentType: 'post',
        }),
      ],
      { now: Date.parse('2026-10-15T00:00:00.000Z') },
    )

    const result = aggregateAnalyticsBatch(batch)
    expect(result.contentHourly).toHaveLength(3)
    expect(result.contentHourly.map((row) => row.hourStart)).toEqual([
      '2026-10-14T01:00:00.000Z',
      '2026-10-14T01:00:00.000Z',
      '2026-10-14T08:00:00.000Z',
    ])
    expect(result.contentHourly.map((row) => row.contentId)).toEqual([
      'content_01',
      'content_01',
      'content_02',
    ])
  })

  it('aggregates follower gain and loss by creator separately from content metrics', () => {
    const batch = processAnalyticsBatch(
      [
        event('evt_000025', 'follow_created', {
          creatorId: 'creator_001',
          contentId: undefined,
          contentType: undefined,
          sessionId: undefined,
        }),
        event('evt_000026', 'follow_removed', {
          creatorId: 'creator_001',
          contentId: undefined,
          contentType: undefined,
          sessionId: undefined,
        }),
        event('evt_000027', 'follow_created', {
          creatorId: 'creator_002',
          contentId: undefined,
          contentType: undefined,
          sessionId: undefined,
        }),
      ],
      { now },
    )

    const result = aggregateAnalyticsBatch(batch)
    expect(result.creatorHourly).toEqual([
      {
        metricVersion: '1.0',
        aggregationWindow: 'hour',
        hourStart: '2026-10-14T00:00:00.000Z',
        creatorId: 'creator_001',
        followersGained: 1,
        followersLost: 1,
      },
      {
        metricVersion: '1.0',
        aggregationWindow: 'hour',
        hourStart: '2026-10-14T00:00:00.000Z',
        creatorId: 'creator_002',
        followersGained: 1,
        followersLost: 0,
      },
    ])
  })

  it('does not aggregate duplicate, late, suspicious, invalid, or rejected events', () => {
    const first = event('evt_000028', 'content_open')
    const duplicate = event('evt_000028', 'content_open', {
      dedupeKey: 'dedupe_different',
    })
    const late = event('evt_000029', 'content_open', {
      occurredAt: '2026-10-10T00:00:00.000Z',
      receivedAt: '2026-10-10T00:00:00.000Z',
    })
    const invalid = event('evt_000030', 'video_complete')
    const rejected = event('evt_000031', 'content_open', {
      schemaVersion: '99.0',
    })
    const batch = processAnalyticsBatch(
      [first, duplicate, late, invalid, rejected],
      { now, maxLatenessMs: 60 * 60 * 1000 },
    )

    const result = aggregateAnalyticsBatch(batch)
    expect(result.contentHourly).toHaveLength(1)
    expect(result.contentHourly[0]?.opens).toBe(1)
    expect(batch.counts.DUPLICATE).toBe(1)
    expect(batch.counts.LATE).toBe(1)
    expect(batch.counts.INVALID).toBe(1)
    expect(batch.counts.REJECTED).toBe(1)
  })

  it('sorts projection output deterministically regardless of input order', () => {
    const inputs = [
      event('evt_000032', 'content_open', { contentId: 'content_z' }),
      event('evt_000033', 'content_open', { contentId: 'content_a' }),
    ]
    const left = aggregateAnalyticsBatch(processAnalyticsBatch(inputs, { now }))
    const right = aggregateAnalyticsBatch(
      processAnalyticsBatch([...inputs].reverse(), { now }),
    )

    expect(left).toEqual(right)
  })

  it('rejects hand-built accepted batches with missing projection keys', () => {
    expect(() =>
      aggregateAnalyticsBatch({
        accepted: [
          event('evt_000034', 'content_open', {
            contentId: undefined,
          }),
        ],
      }),
    ).toThrow('Accepted content analytics events must include contentId and contentType')
  })
})
