import {
  type AnalyticsBatchOptions,
  type AnalyticsBatchResult,
} from './analytics-event-quality'
import { processAnalyticsBatch } from './analytics-event-quality'
import type { AnalyticsPostgresPool } from './analytics-postgres-store'
import {
  persistAnalyticsEventsPostgres,
  type PersistAnalyticsPostgresBatchResult,
} from './analytics-postgres-ingest'

export interface AnalyticsPostgresIngestResult {
  quality: AnalyticsBatchResult
  persistence: PersistAnalyticsPostgresBatchResult
}

/** Native PostgreSQL ingestion for already-authorized internal deliveries. */
export async function ingestAnalyticsBatchPostgres(
  pool: AnalyticsPostgresPool,
  values: readonly unknown[],
  options: AnalyticsBatchOptions,
): Promise<AnalyticsPostgresIngestResult> {
  const quality = processAnalyticsBatch(values, options)
  const lateEvents = quality.outcomes.flatMap((outcome) =>
    outcome.quality === 'LATE' && outcome.event ? [outcome.event] : [],
  )
  const persistence = await persistAnalyticsEventsPostgres(pool, quality.accepted, lateEvents)

  const liveDuplicateIds = new Set(persistence.duplicateEventIds)
  const lateDuplicateIds = new Set(persistence.lateDuplicateEventIds)
  const acceptedIds = new Set(quality.accepted.map((event) => event.eventId))
  const lateIds = new Set(lateEvents.map((event) => event.eventId))
  if (
    liveDuplicateIds.size !== persistence.duplicateEventIds.length ||
    persistence.duplicateEventIds.some((eventId) => !acceptedIds.has(eventId)) ||
    lateDuplicateIds.size !== persistence.lateDuplicateEventIds.length ||
    persistence.lateDuplicateEventIds.some((eventId) => !lateIds.has(eventId)) ||
    persistence.duplicateEventIds.some((eventId) => lateDuplicateIds.has(eventId))
  ) {
    throw new Error('PostgreSQL duplicate results did not match batch event identities')
  }

  if (liveDuplicateIds.size === 0 && lateDuplicateIds.size === 0) {
    return { quality, persistence }
  }

  const reconciledQuality: AnalyticsBatchResult = {
    ...quality,
    accepted: quality.accepted.filter((event) => !liveDuplicateIds.has(event.eventId)),
    outcomes: quality.outcomes.map((outcome) => {
      const eventId = outcome.event?.eventId
      const persistedDuplicate =
        (outcome.quality === 'VALID' && eventId && liveDuplicateIds.has(eventId)) ||
        (outcome.quality === 'LATE' && eventId && lateDuplicateIds.has(eventId))
      if (!persistedDuplicate || !eventId) return outcome
      return {
        quality: 'DUPLICATE',
        reason: 'PERSISTED_EVENT_ID_OR_DEDUPE_KEY',
        eventId,
      }
    }),
    counts: {
      ...quality.counts,
      VALID: quality.counts.VALID - liveDuplicateIds.size,
      LATE: quality.counts.LATE - lateDuplicateIds.size,
      DUPLICATE: quality.counts.DUPLICATE + liveDuplicateIds.size + lateDuplicateIds.size,
    },
  }

  return { quality: reconciledQuality, persistence }
}
