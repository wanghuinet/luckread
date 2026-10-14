/**
 * Reused and adapted from Traks' MIT-licensed analytics shared module:
 * packages/shared/src/queries.ts
 * Upstream revision: 5b3a97eb4d403c170479a2626697eb4fd9604c36
 * Upstream: https://github.com/shivamanupadi/traks
 * See ../THIRD-PARTY-NOTICES.md for the required MIT notice.
 *
 * This module retains the upstream timezone-aware bucket and reporting-window
 * approach, while exposing only the pure functions needed by W11. It does not
 * import Traks' R2 SQL, Workers, D1, Durable Object, or pipeline architecture.
 */

export type AnalyticsPeriod =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | '90d'
  | '6m'
  | '1y'
  | 'all'

export interface AnalyticsPeriodRange {
  from: string
  to: string
  granularity: 'hour' | 'day' | 'week'
  /** Ordered local-time bucket keys; empty for week-based/all-time ranges. */
  buckets: string[]
  timeZone: string
  /** Calendar-day window; zero means an all-time range. */
  days: number
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()
const ALL_TIME_FLOOR_MS = Date.UTC(2000, 0, 1)
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    if (formatterCache.size > 200) formatterCache.clear()
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

function assertValidDate(date: Date): void {
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError('date must be a valid Date')
  }
}

/** Convert an instant into calendar/clock parts in the selected IANA zone. */
function partsInTimeZone(date: Date, timeZone: string): ZonedParts {
  assertValidDate(date)
  const parts = formatterFor(timeZone).formatToParts(date)
  const get = (kind: string): number => {
    const part = parts.find((item) => item.type === kind)
    if (!part) throw new RangeError(`Unable to resolve ${kind} in ${timeZone}`)
    return Number(part.value)
  }

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some Intl implementations render midnight as 24:00.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  }
}

/** UTC instant corresponding to midnight at the start of the local calendar day. */
function startOfDayInTimeZone(date: Date, timeZone: string): Date {
  const local = partsInTimeZone(date, timeZone)
  const utcMidnight = new Date(
    Date.UTC(local.year, local.month - 1, local.day, 0, 0, 0),
  )
  const rendered = partsInTimeZone(utcMidnight, timeZone)
  const renderedMs = Date.UTC(
    rendered.year,
    rendered.month - 1,
    rendered.day,
    rendered.hour,
    rendered.minute,
    rendered.second,
  )
  const targetMs = Date.UTC(local.year, local.month - 1, local.day, 0, 0, 0)
  return new Date(utcMidnight.getTime() + (targetMs - renderedMs))
}

/**
 * Move by calendar days rather than 24-hour durations, then snap back to local
 * midnight. The noon offset prevents DST transitions from skewing the result.
 */
function startOfDayNDays(date: Date, timeZone: string, count: number): Date {
  const noonish = new Date(
    startOfDayInTimeZone(date, timeZone).getTime() +
      count * DAY_MS +
      12 * HOUR_MS,
  )
  return startOfDayInTimeZone(noonish, timeZone)
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** ISO-8601 week key; the caller supplies date components in the chosen zone. */
function isoWeekKeyFromParts(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  const isoDay = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - isoDay)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7,
  )
  return `${date.getUTCFullYear()}-W${pad2(week)}`
}

/** Local day/hour/week bucket keys from one event timestamp. */
export function computeAnalyticsBucketKeys(
  date: Date,
  timeZone: string,
): { dateKey: string; hourKey: string; weekKey: string } {
  const parts = partsInTimeZone(date, timeZone)
  const dateKey = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
  return {
    dateKey,
    hourKey: `${dateKey}T${pad2(parts.hour)}`,
    weekKey: isoWeekKeyFromParts(parts.year, parts.month, parts.day),
  }
}

/**
 * Resolve a reporting period in the supplied timezone.
 *
 * `now` and every returned boundary are instants; bucket labels are local to
 * `timeZone`. This is a pure helper and performs no storage or network I/O.
 */
export function resolveAnalyticsPeriod(
  period: AnalyticsPeriod,
  now: Date,
  timeZone: string,
): AnalyticsPeriodRange {
  assertValidDate(now)
  // Validate the timezone even for the 'all' period, which needs few conversions.
  formatterFor(timeZone)

  let to = now
  let from: Date
  let granularity: AnalyticsPeriodRange['granularity']
  let days: number

  switch (period) {
    case 'today':
      from = startOfDayInTimeZone(now, timeZone)
      granularity = 'hour'
      days = 1
      break
    case 'yesterday':
      to = startOfDayInTimeZone(now, timeZone)
      from = startOfDayNDays(now, timeZone, -1)
      granularity = 'hour'
      days = 1
      break
    case '7d':
      from = startOfDayNDays(now, timeZone, -6)
      granularity = 'day'
      days = 7
      break
    case '30d':
      from = startOfDayNDays(now, timeZone, -29)
      granularity = 'day'
      days = 30
      break
    case '90d':
      from = startOfDayNDays(now, timeZone, -89)
      granularity = 'day'
      days = 90
      break
    case '6m':
      from = startOfDayNDays(now, timeZone, -179)
      granularity = 'day'
      days = 180
      break
    case '1y':
      from = startOfDayNDays(now, timeZone, -364)
      granularity = 'week'
      days = 365
      break
    case 'all':
      from = new Date(ALL_TIME_FLOOR_MS)
      granularity = 'week'
      days = 0
      break
    default: {
      const exhaustive: never = period
      throw new TypeError(`Unsupported analytics period: ${String(exhaustive)}`)
    }
  }

  const bucketsTo = period === 'yesterday' ? new Date(to.getTime() - 1) : to
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    granularity,
    buckets:
      granularity === 'week'
        ? []
        : generateAnalyticsBuckets(from, bucketsTo, granularity, timeZone),
    timeZone,
    days,
  }
}

function generateAnalyticsBuckets(
  from: Date,
  to: Date,
  granularity: 'hour' | 'day',
  timeZone: string,
): string[] {
  const keys: string[] = []
  if (granularity === 'hour') {
    for (let instant = from.getTime(); instant <= to.getTime(); instant += HOUR_MS) {
      keys.push(computeAnalyticsBucketKeys(new Date(instant), timeZone).hourKey)
    }
    // The repeated local hour during fall-back represents one dashboard bucket.
    return [...new Set(keys)]
  }

  const dayKey = (date: Date): string => computeAnalyticsBucketKeys(date, timeZone).dateKey
  let cursor = startOfDayInTimeZone(from, timeZone)
  const endKey = dayKey(to)
  // Bound the loop so an unexpected timezone/runtime behavior cannot run forever.
  for (let index = 0; index < 800; index += 1) {
    const key = dayKey(cursor)
    keys.push(key)
    if (key >= endKey) break
    cursor = startOfDayNDays(cursor, timeZone, 1)
  }
  return keys
}

export interface AnalyticsComparisonRange {
  from: string
  to: string
}

/**
 * Resolve a like-for-like comparison window before a current reporting range.
 *
 * Adapted from Traks' MIT-licensed `previousRange` helper. Shifting by
 * calendar days in the configured IANA timezone avoids DST drift and preserves
 * the elapsed portion of the current day. An all-time range compares to empty
 * rather than scanning an artificial second all-time window.
 */
export function previousAnalyticsRange(
  range: AnalyticsPeriodRange,
): AnalyticsComparisonRange {
  const currentFrom = new Date(range.from)
  const currentTo = new Date(range.to)
  if (
    !Number.isFinite(currentFrom.getTime()) ||
    !Number.isFinite(currentTo.getTime()) ||
    currentTo.getTime() < currentFrom.getTime()
  ) {
    throw new RangeError('range must contain valid ordered from/to instants')
  }
  if (!Number.isSafeInteger(range.days) || range.days < 0) {
    throw new RangeError('range.days must be a non-negative safe integer')
  }

  if (currentFrom.getTime() <= ALL_TIME_FLOOR_MS || range.days === 0) {
    const empty = currentFrom.toISOString()
    return { from: empty, to: empty }
  }

  const timeZone = range.timeZone || 'UTC'
  formatterFor(timeZone)

  const previousFrom = startOfDayNDays(currentFrom, timeZone, -range.days)
  const intoCurrentDay =
    currentTo.getTime() - startOfDayInTimeZone(currentTo, timeZone).getTime()
  const previousTo = new Date(
    startOfDayNDays(currentTo, timeZone, -range.days).getTime() + intoCurrentDay,
  )

  if (previousTo.getTime() < previousFrom.getTime()) {
    throw new RangeError('calculated comparison range is not ordered')
  }

  return {
    from: previousFrom.toISOString(),
    to: previousTo.toISOString(),
  }
}
