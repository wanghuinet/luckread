import { describe, expect, it, vi } from 'vitest'
import {
  getContentAnalyticsSummary,
  getCreatorFollowerSummary,
  getTopContentAnalyticsForContentSet,
  type AnalyticsReadDatabase,
  type AnalyticsReadStatement,
} from './analytics-read-model'

const from = '2026-10-01T00:00:00.000Z'
const to = '2026-10-14T00:00:00.000Z'

function fakeDb(row: Record<string, unknown> | null) {
  let sql = ''
  let boundValues: (string | number | null)[] = []
  let prepareCalls = 0
  const statement = {
    bind: vi.fn((...values: (string | number | null)[]) => {
      boundValues = values
      return statement
    }),
    first: vi.fn(async () => row),
    all: vi.fn(async () => ({ results: row ? [row] : [] })),
  }
  const db: AnalyticsReadDatabase = {
    prepare: vi.fn((query: string) => {
      sql = query
      prepareCalls += 1
      return statement as unknown as AnalyticsReadStatement
    }),
  }

  return {
    db,
    statement,
    getSql: () => sql,
    getBoundValues: () => boundValues,
    getPrepareCalls: () => prepareCalls,
  }
}

describe('W11 bounded analytics read models', () => {
  it('returns content metrics using a parameterized bounded indexed query', async () => {
    const fixture = fakeDb({
      impressions: '41', opens: 12, likes: 5, readStarts: 10,
      readProgress25: 8, readCompletions: 4,
      readDurationMs: 1200, readDurationEvents: 3,
      dwellDurationMs: 400, dwellEvents: 2,
      videoPlayRequests: 25, videoPlays: 20,
      videoProgress25: 18, videoProgress50: 14, videoProgress75: 10,
      videoProgress90: 5, videoCompletions: 3,
      videoWatchMs: 8000, videoWatchEvents: 4,
    })
    const result = await getContentAnalyticsSummary(fixture.db, {
      contentId: 'article_001',
      contentType: 'article',
      window: { from, to },
    })

    expect(result).toMatchObject({
      contentId: 'article_001',
      contentType: 'article',
      from,
      to,
      impressions: 41,
      opens: 12,
      likes: 5,
      comments: 0,
      videoPlays: 20,
      openRate: 12 / 41,
      readStartRate: 10 / 12,
      readProgress25Rate: 0.8,
      readCompletionRate: 0.4,
      averageReadDwellEventMs: 400,
      averageDwellEventMs: 200,
      videoPlaySuccessRate: 0.8,
      videoProgress25Rate: 0.9,
      videoCompletionRate: 0.15,
      averageVideoWatchEventMs: 2000,
      likesPerOpen: 5 / 12,
    })
    expect(fixture.getSql()).toContain('FROM analytics_content_hourly')
    expect(fixture.getSql()).toContain('content_id = ?')
    expect(fixture.getSql()).toContain('hour_start >= ?')
    expect(fixture.getSql()).toContain('hour_start < ?')
    expect(fixture.getSql()).not.toContain('article_001')
    expect(fixture.getBoundValues()).toEqual([
      'article_001',
      'article',
      from,
      to,
      '1.0',
    ])
  })

  it('includes every hourly bucket overlapping a partial-hour request and labels the bucket range', async () => {
    const fixture = fakeDb({ impressions: 3 })
    const requestedFrom = '2026-10-14T00:30:00.000Z'
    const requestedTo = '2026-10-14T02:15:00.000Z'
    const result = await getContentAnalyticsSummary(fixture.db, {
      contentId: 'article_001',
      contentType: 'article',
      window: { from: requestedFrom, to: requestedTo },
    })

    expect(result).toMatchObject({
      from: requestedFrom,
      to: requestedTo,
      granularity: 'hour',
      bucketFrom: '2026-10-14T00:00:00.000Z',
      bucketToExclusive: '2026-10-14T03:00:00.000Z',
      impressions: 3,
    })
    expect(fixture.getBoundValues()).toEqual([
      'article_001',
      'article',
      '2026-10-14T00:00:00.000Z',
      '2026-10-14T03:00:00.000Z',
      '1.0',
    ])
  })

  it('does not claim event-count ratios are bounded probabilities', async () => {
    const fixture = fakeDb({
      readStarts: 2,
      readProgress25: 5,
      videoPlays: 2,
      videoProgress25: 4,
    })
    const result = await getContentAnalyticsSummary(fixture.db, {
      contentId: 'article_001',
      contentType: 'article',
      window: { from, to },
    })

    // Until producers coalesce progress per session, these are event ratios.
    expect(result.readProgress25Rate).toBe(2.5)
    expect(result.videoProgress25Rate).toBe(2)
  })

  it('returns zero-valued content metrics when no hourly projection exists', async () => {
    const fixture = fakeDb(null)
    const result = await getContentAnalyticsSummary(fixture.db, {
      contentId: 'video_001',
      contentType: 'video',
      window: { from, to },
    })

    expect(result.impressions).toBe(0)
    expect(result.videoPlays).toBe(0)
    expect(result.favorites).toBe(0)
    expect(result.openRate).toBeNull()
    expect(result.readCompletionRate).toBeNull()
    expect(result.averageReadDwellEventMs).toBeNull()
    expect(result.videoCompletionRate).toBeNull()
    expect(result.likesPerOpen).toBeNull()
  })

  it('aggregates follower changes as a period delta rather than current authority state', async () => {
    const fixture = fakeDb({ followersGained: '7', followersLost: 11 })
    const result = await getCreatorFollowerSummary(fixture.db, {
      creatorId: 'creator_001',
      window: { from, to },
    })

    expect(result).toEqual({
      creatorId: 'creator_001',
      from,
      to,
      granularity: 'hour',
      bucketFrom: from,
      bucketToExclusive: to,
      followersGained: 7,
      followersLost: 11,
      netFollowers: -4,
    })
    expect(fixture.getSql()).toContain('FROM analytics_creator_hourly')
    expect(fixture.getSql()).toContain('creator_id = ?')
    expect(fixture.getBoundValues()).toEqual(['creator_001', from, to, '1.0'])
  })

  it('rejects impossible UTC calendar timestamps before issuing a query', async () => {
    const fixture = fakeDb(null)
    await expect(
      getContentAnalyticsSummary(fixture.db, {
        contentId: 'article_001',
        contentType: 'article',
        window: {
          from: '2026-02-30T00:00:00.000Z',
          to,
        },
      }),
    ).rejects.toThrow('from must be a real calendar timestamp')
    expect(fixture.getPrepareCalls()).toBe(0)
  })

  it('rejects reversed, empty and oversized query windows', async () => {
    const fixture = fakeDb(null)
    await expect(
      getCreatorFollowerSummary(fixture.db, {
        creatorId: 'creator_001',
        window: { from: to, to },
      }),
    ).rejects.toThrow('ordered and non-empty')

    await expect(
      getContentAnalyticsSummary(fixture.db, {
        contentId: 'article_001',
        contentType: 'article',
        window: {
          from: '2025-10-13T00:00:00.000Z',
          to: '2026-10-15T00:00:00.000Z',
        },
      }),
    ).rejects.toThrow('cannot exceed 366 days')
    expect(fixture.getPrepareCalls()).toBe(0)
  })

  it('rejects invalid identifiers, content types and unsafe aggregate counts', async () => {
    const noCalls = fakeDb({ impressions: -1 })
    await expect(
      getContentAnalyticsSummary(noCalls.db, {
        contentId: 'article_001 ',
        contentType: 'article',
        window: { from, to },
      }),
    ).rejects.toThrow('contentId is invalid')

    await expect(
      getContentAnalyticsSummary(noCalls.db, {
        contentId: 'article_001',
        contentType: 'other' as never,
        window: { from, to },
      }),
    ).rejects.toThrow('contentType is invalid')

    await expect(
      getContentAnalyticsSummary(noCalls.db, {
        contentId: 'article_001',
        contentType: 'article',
        window: { from, to },
      }),
    ).rejects.toThrow('invalid count for impressions')
  })

  it('ranks an explicit deduplicated content set with parameterized filters and a bounded limit', async () => {
    const fixture = fakeDb({
      contentId: 'article_001',
      contentType: 'article',
      impressions: 100,
      opens: 70,
      readStarts: 60,
      readCompletions: 30,
    })
    const result = await getTopContentAnalyticsForContentSet(fixture.db, {
      contentIds: ['article_001', 'post_001', 'article_001'],
      window: {
        from: '2026-10-14T00:30:00.000Z',
        to: '2026-10-14T02:15:00.000Z',
      },
      limit: 5,
    })

    expect(result).toMatchObject({
      granularity: 'hour',
      bucketFrom: '2026-10-14T00:00:00.000Z',
      bucketToExclusive: '2026-10-14T03:00:00.000Z',
      items: [{
        rank: 1,
        contentId: 'article_001',
        contentType: 'article',
        impressions: 100,
        opens: 70,
        readStarts: 60,
        readCompletions: 30,
        readCompletionRate: 0.5,
      }],
    })
    expect(fixture.getSql()).toContain('content_id IN (?, ?)')
    expect(fixture.getSql()).toContain('GROUP BY content_id, content_type')
    expect(fixture.getSql()).toContain('ORDER BY opens DESC, impressions DESC')
    expect(fixture.getSql()).toContain('LIMIT ?')
    expect(fixture.getSql()).not.toContain('article_001')
    expect(fixture.getBoundValues()).toEqual([
      'article_001',
      'post_001',
      '2026-10-14T00:00:00.000Z',
      '2026-10-14T03:00:00.000Z',
      '1.0',
      5,
    ])
  })

  it('ranks short videos by an allowlisted playback metric when requested', async () => {
    const fixture = fakeDb({
      contentId: 'video_001',
      contentType: 'video',
      impressions: 50,
      opens: 0,
      videoPlays: 42,
      videoCompletions: 31,
    })
    const result = await getTopContentAnalyticsForContentSet(fixture.db, {
      contentIds: ['video_001', 'video_002'],
      window: { from, to },
      rankBy: 'videoPlays',
      limit: 3,
    })

    expect(result.items[0]).toMatchObject({
      rank: 1,
      contentId: 'video_001',
      contentType: 'video',
      opens: 0,
      videoPlays: 42,
      videoCompletions: 31,
    })
    expect(fixture.getSql()).toContain('ORDER BY videoPlays DESC, opens DESC, impressions DESC')
    expect(fixture.getSql()).not.toContain('ORDER BY opens DESC, impressions DESC')
    expect(fixture.getBoundValues()).toEqual([
      'video_001',
      'video_002',
      from,
      to,
      '1.0',
      3,
    ])
  })

  it('rejects unrecognized ranking metrics before querying D1', async () => {
    const fixture = fakeDb(null)
    await expect(
      getTopContentAnalyticsForContentSet(fixture.db, {
        contentIds: ['video_001'],
        window: { from, to },
        rankBy: 'attacker_supplied_sql' as never,
      }),
    ).rejects.toThrow('rankBy is invalid')
    expect(fixture.getPrepareCalls()).toBe(0)
  })

  it('returns an empty ranking without querying D1 for an empty authorized content set', async () => {
    const fixture = fakeDb(null)
    const result = await getTopContentAnalyticsForContentSet(fixture.db, {
      contentIds: [],
      window: { from, to },
    })

    expect(result.items).toEqual([])
    expect(fixture.getPrepareCalls()).toBe(0)
  })

  it('rejects oversized content sets and invalid ranking limits before querying D1', async () => {
    const fixture = fakeDb(null)
    const contentIds = Array.from({ length: 91 }, (_, index) => `content_${index.toString().padStart(3, '0')}`)
    await expect(
      getTopContentAnalyticsForContentSet(fixture.db, {
        contentIds,
        window: { from, to },
      }),
    ).rejects.toThrow('cannot exceed 90 items')

    await expect(
      getTopContentAnalyticsForContentSet(fixture.db, {
        contentIds: ['content_001'],
        window: { from, to },
        limit: 21,
      }),
    ).rejects.toThrow('between 1 and 20')
    expect(fixture.getPrepareCalls()).toBe(0)
  })

  it('propagates storage read failures without returning fabricated analytics', async () => {
    const fixture = fakeDb(null)
    fixture.statement.first.mockRejectedValue(new Error('D1 read failed'))
    await expect(
      getCreatorFollowerSummary(fixture.db, {
        creatorId: 'creator_001',
        window: { from, to },
      }),
    ).rejects.toThrow('D1 read failed')
  })
})
