import { ANALYTICS_METRIC_VERSION } from './analytics-aggregation'
import {
  ANALYTICS_MAX_BATCH_SIZE,
  type AnalyticsEvent,
} from './analytics-event-quality'

/**
 * Structural subset of Cloudflare D1 used by this adapter. Keeping this
 * interface narrow makes the adapter testable without a live Cloudflare DB.
 */
export interface AnalyticsD1Result {
  success?: boolean
  error?: string
  meta?: {
    changes?: number
  }
}

export interface AnalyticsD1PreparedStatement {
  bind(...values: (string | number | null)[]): AnalyticsD1PreparedStatement
  run(): Promise<AnalyticsD1Result>
}

export interface AnalyticsD1Database {
  prepare(query: string): AnalyticsD1PreparedStatement
}

export interface PersistAnalyticsBatchResult {
  attempted: number
  inserted: number
  duplicates: number
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
] as const

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
  ]
}

/**
 * Store already validated events in D1-05.
 *
 * The migration's AFTER INSERT trigger updates hourly projections in the same
 * SQLite transaction as the unique event/dedupe insert. Duplicate event IDs or
 * dedupe keys are ignored by SQLite, so their trigger cannot increment metrics
 * a second time. A failed statement leaves neither dedupe rows nor projections
 * partially committed.
 *
 * This function does not accept arbitrary browser input: callers must pass only
 * the accepted events returned by processAnalyticsBatch after source validation.
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
    return { attempted: 0, inserted: 0, duplicates: 0 }
  }

  const valuesPerEvent = INSERT_COLUMNS.length
  const placeholders = events
    .map(() => `(${Array.from({ length: valuesPerEvent }, () => '?').join(', ')})`)
    .join(', ')
  const sql = `INSERT OR IGNORE INTO analytics_event_dedupe (${INSERT_COLUMNS.join(', ')}) VALUES ${placeholders}`
  const bindings = events.flatMap(bindValues)
  const result = await db.prepare(sql).bind(...bindings).run()

  if (result.success === false) {
    throw new Error(result.error || 'D1 analytics batch insert failed')
  }

  const inserted = result.meta?.changes
  if (
    typeof inserted !== 'number' ||
    !Number.isSafeInteger(inserted) ||
    inserted < 0 ||
    inserted > events.length
  ) {
    throw new Error('D1 analytics insert did not return a valid changes count')
  }

  return {
    attempted: events.length,
    inserted,
    duplicates: events.length - inserted,
  }
}
