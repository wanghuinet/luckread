import { describe, expect, it } from 'vitest'
import {
  computeAnalyticsBucketKeys,
  previousAnalyticsRange,
  resolveAnalyticsPeriod,
} from './analytics-period'

describe('W11 analytics period helpers (adapted from Traks MIT shared module)', () => {
  it('computes local date, hour and ISO week keys using the configured timezone', () => {
    expect(
      computeAnalyticsBucketKeys(
        new Date('2026-03-08T10:30:00.000Z'),
        'America/Los_Angeles',
      ),
    ).toEqual({
      dateKey: '2026-03-08',
      hourKey: '2026-03-08T03',
      weekKey: '2026-W10',
    })
  })

  it('resolves today at local midnight and skips the nonexistent spring-DST hour', () => {
    const range = resolveAnalyticsPeriod(
      'today',
      new Date('2026-03-08T20:00:00.000Z'),
      'America/Los_Angeles',
    )

    expect(range.from).toBe('2026-03-08T08:00:00.000Z')
    expect(range.to).toBe('2026-03-08T20:00:00.000Z')
    expect(range.granularity).toBe('hour')
    expect(range.buckets[0]).toBe('2026-03-08T00')
    expect(range.buckets).not.toContain('2026-03-08T02')
    expect(range.buckets.at(-1)).toBe('2026-03-08T13')
  })

  it('uses calendar-day windows across DST rather than adding fixed 24-hour blocks', () => {
    const range = resolveAnalyticsPeriod(
      '7d',
      new Date('2026-03-08T19:00:00.000Z'),
      'America/Los_Angeles',
    )

    expect(range.from).toBe('2026-03-02T08:00:00.000Z')
    expect(range.to).toBe('2026-03-08T19:00:00.000Z')
    expect(range.granularity).toBe('day')
    expect(range.buckets).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ])
  })

  it('closes yesterday at the current local midnight without including today', () => {
    const range = resolveAnalyticsPeriod(
      'yesterday',
      new Date('2026-10-14T19:00:00.000Z'),
      'America/Los_Angeles',
    )

    expect(range.to).toBe('2026-10-14T07:00:00.000Z')
    expect(range.buckets.at(-1)).toBe('2026-10-13T23')
    expect(range.buckets).not.toContain('2026-10-14T00')
  })

  it('rejects invalid dates and timezones', () => {
    expect(() =>
      resolveAnalyticsPeriod('today', new Date(Number.NaN), 'UTC'),
    ).toThrow(RangeError)
    expect(() =>
      resolveAnalyticsPeriod('today', new Date('2026-10-14T00:00:00.000Z'), 'Mars/Olympus'),
    ).toThrow(RangeError)
  })
})

describe('previous analytics range', () => {
  it('compares today with the same elapsed local-day window', () => {
    const current = resolveAnalyticsPeriod(
      'today',
      new Date('2026-10-14T19:00:00.000Z'),
      'America/Los_Angeles',
    )

    expect(previousAnalyticsRange(current)).toEqual({
      from: '2026-10-13T07:00:00.000Z',
      to: '2026-10-13T19:00:00.000Z',
    })
  })

  it('shifts comparison windows by calendar days across a DST transition', () => {
    const current = resolveAnalyticsPeriod(
      '7d',
      new Date('2026-03-08T19:00:00.000Z'),
      'America/Los_Angeles',
    )

    expect(previousAnalyticsRange(current)).toEqual({
      from: '2026-02-23T08:00:00.000Z',
      to: '2026-03-01T20:00:00.000Z',
    })
  })

  it('does not double-scan for all-time periods', () => {
    const current = resolveAnalyticsPeriod(
      'all',
      new Date('2026-10-14T19:00:00.000Z'),
      'America/Los_Angeles',
    )

    expect(previousAnalyticsRange(current)).toEqual({
      from: '2000-01-01T00:00:00.000Z',
      to: '2000-01-01T00:00:00.000Z',
    })
  })

  it('rejects invalid window bounds and negative day counts', () => {
    expect(() =>
      previousAnalyticsRange({
        from: 'not-a-date',
        to: '2026-10-14T19:00:00.000Z',
        granularity: 'hour',
        buckets: [],
        timeZone: 'UTC',
        days: 1,
      }),
    ).toThrow(RangeError)

    expect(() =>
      previousAnalyticsRange({
        from: '2026-10-14T19:00:00.000Z',
        to: '2026-10-14T18:00:00.000Z',
        granularity: 'hour',
        buckets: [],
        timeZone: 'UTC',
        days: 1,
      }),
    ).toThrow(RangeError)

    expect(() =>
      previousAnalyticsRange({
        from: '2026-10-14T00:00:00.000Z',
        to: '2026-10-14T19:00:00.000Z',
        granularity: 'hour',
        buckets: [],
        timeZone: 'UTC',
        days: -1,
      }),
    ).toThrow(RangeError)
  })
})
