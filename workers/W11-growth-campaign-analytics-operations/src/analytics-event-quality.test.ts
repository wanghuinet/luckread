import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_MAX_BATCH_SIZE,
  processAnalyticsBatch,
  validateAnalyticsEvent,
  type AnalyticsEvent,
} from './analytics-event-quality'

const now = Date.parse('2026-10-14T00:00:00.000Z')
const timestamp = '2026-10-14T00:00:00.000Z'

function event(overrides: Record<string, unknown> = {}): AnalyticsEvent {
  return {
    eventId: 'evt_000001',
    schemaVersion: '1.0',
    eventName: 'content_open',
    sourceWorker: 'W03',
    occurredAt: timestamp,
    receivedAt: timestamp,
    dedupeKey: 'dedupe_000001',
    actorType: 'user',
    actorId: 'user_0001',
    sessionId: 'session_001',
    contentId: 'content_01',
    contentType: 'article',
    ...overrides,
  } as AnalyticsEvent
}

describe('W11 analytics event quality', () => {
  it('accepts a valid server-originated content event and normalizes only allow-listed fields', () => {
    const result = validateAnalyticsEvent(
      { ...event(), properties: { email: 'private@example.com', arbitrary: true } },
      { now },
    )

    expect(result.quality).toBe('VALID')
    expect(result.event?.eventId).toBe('evt_000001')
    expect(result.event).not.toHaveProperty('properties')
  })

  it('rejects an event emitted outside the owning Worker boundary', () => {
    const result = validateAnalyticsEvent(event({ sourceWorker: 'W05' }), { now })

    expect(result.quality).toBe('REJECTED')
    expect(result.reason).toBe('SOURCE_WORKER_NOT_AUTHORIZED_FOR_EVENT')
  })

  it('rejects an unsupported event schema version', () => {
    const result = validateAnalyticsEvent(
      { ...event(), schemaVersion: '9.0' },
      { now },
    )

    expect(result.quality).toBe('REJECTED')
    expect(result.reason).toBe('UNSUPPORTED_SCHEMA_VERSION')
  })

  it('rejects a video milestone mislabeled as an article event', () => {
    const result = validateAnalyticsEvent(event({ eventName: 'video_complete' }), {
      now,
    })

    expect(result.quality).toBe('INVALID')
    expect(result.reason).toBe('VIDEO_EVENT_REQUIRES_VIDEO_CONTENT')
  })

  it('classifies malformed event ids and timestamps as invalid', () => {
    expect(
      validateAnalyticsEvent(event({ eventId: 'short' }), { now }).quality,
    ).toBe('INVALID')
    expect(
      validateAnalyticsEvent(event({ occurredAt: 'not-a-timestamp' }), {
        now,
      }).reason,
    ).toBe('INVALID_EVENT_TIMESTAMP')
  })

  it('rejects impossible calendar dates and out-of-range clock fields', () => {
    const invalidTimestamps = [
      '2026-02-30T00:00:00.000Z',
      '2025-02-29T00:00:00.000Z',
      '2026-13-01T00:00:00.000Z',
      '2026-10-14T24:00:00.000Z',
      '2026-10-14T00:60:00.000Z',
      '2026-10-14T00:00:60.000Z',
      '2026-10-14T00:00:00.000+25:00',
    ]

    for (const invalidTimestamp of invalidTimestamps) {
      expect(
        validateAnalyticsEvent(event({ occurredAt: invalidTimestamp }), {
          now,
        }).reason,
      ).toBe('INVALID_EVENT_TIMESTAMP')
    }
  })

  it('classifies events outside the live lateness window separately', () => {
    const old = '2026-10-12T00:00:00.000Z'
    const result = validateAnalyticsEvent(
      event({ occurredAt: old, receivedAt: old }),
      { now, maxLatenessMs: 60 * 60 * 1000 },
    )

    expect(result.quality).toBe('LATE')
    expect(result.reason).toBe('EVENT_EXCEEDS_LIVE_LATENESS_WINDOW')
    expect(result.event?.occurredAt).toBe(old)
  })

  it('marks event timestamps outside the allowed clock skew as suspect', () => {
    const future = '2026-10-14T00:10:00.000Z'
    const result = validateAnalyticsEvent(
      event({ occurredAt: future, receivedAt: timestamp }),
      { now },
    )

    expect(result.quality).toBe('SUSPECT')
    expect(result.reason).toBe('EVENT_TIMESTAMP_OUTSIDE_CLOCK_SKEW')
  })

  it('deduplicates event ids and dedupe keys within a batch', () => {
    const first = event()
    const sameEventId = event({ dedupeKey: 'dedupe_000002' })
    const sameDedupeKey = event({ eventId: 'evt_000002' })
    const result = processAnalyticsBatch(
      [first, sameEventId, sameDedupeKey],
      { now },
    )

    expect(result.accepted).toHaveLength(1)
    expect(result.counts.VALID).toBe(1)
    expect(result.counts.DUPLICATE).toBe(2)
    expect(result.outcomes.map((item) => item.quality)).toEqual([
      'VALID',
      'DUPLICATE',
      'DUPLICATE',
    ])
  })

  it('uses persisted idempotency keys supplied by the storage adapter', () => {
    const result = processAnalyticsBatch([event()], {
      now,
      knownEventIds: new Set(['evt_000001']),
    })

    expect(result.accepted).toHaveLength(0)
    expect(result.outcomes[0]?.reason).toBe('DUPLICATE_EVENT_ID')
  })

  it('rejects batches above the hard limit before validating each event', () => {
    const oversized = Array.from(
      { length: ANALYTICS_MAX_BATCH_SIZE + 1 },
      (_, index) => event({
        eventId: `evt_${String(index).padStart(6, '0')}`,
        dedupeKey: `dedupe_${String(index).padStart(6, '0')}`,
      }),
    )

    expect(() => processAnalyticsBatch(oversized, { now })).toThrow(
      `batch exceeds the ${ANALYTICS_MAX_BATCH_SIZE}-event limit`,
    )
  })

  it('requires authenticated actors for social interaction events', () => {
    const result = validateAnalyticsEvent(
      event({
        eventName: 'like_created',
        sourceWorker: 'W05',
        actorType: 'visitor',
        actorId: undefined,
        visitorId: 'visitor_01',
      }),
      { now },
    )

    expect(result.quality).toBe('INVALID')
    expect(result.reason).toBe('SOCIAL_EVENTS_REQUIRE_AUTHENTICATED_ACTOR')
  })

  it('requires a content type on content-bound social events', () => {
    const result = validateAnalyticsEvent(
      event({
        eventName: 'like_created',
        sourceWorker: 'W05',
        contentType: undefined,
      }),
      { now },
    )

    expect(result.quality).toBe('INVALID')
    expect(result.reason).toBe('CONTENT_SOCIAL_EVENT_REQUIRES_CONTENT_TYPE')
  })

  it('rejects missing duration for dwell/watch events', () => {
    const result = validateAnalyticsEvent(
      event({
        eventName: 'video_watch',
        contentType: 'video',
        durationMs: undefined,
      }),
      { now },
    )

    expect(result.quality).toBe('INVALID')
    expect(result.reason).toBe('INVALID_DURATION_MS')
  })
})
