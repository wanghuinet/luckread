import type {
  AnalyticsBatchOptions,
  AnalyticsBatchResult,
} from './analytics-event-quality'
import { processAnalyticsBatch } from './analytics-event-quality'
import type {
  AnalyticsD1Database,
  PersistAnalyticsBatchResult,
} from './analytics-d1-store'
import { persistAnalyticsEvents } from './analytics-d1-store'

export interface AnalyticsIngestResult {
  quality: AnalyticsBatchResult
  persistence: PersistAnalyticsBatchResult
}

/**
 * Internal W11 ingestion pipeline for already-authorized server event deliveries.
 *
 * Only VALID events enter D1-05. SUSPECT, INVALID, DUPLICATE, LATE and REJECTED
 * outcomes remain visible to the caller for quarantine/metrics decisions and are
 * not projected by this live path. This is intentionally not an HTTP route:
 * caller authentication, producer authorization and transport admission belong
 * to the existing Worker/event delivery contract.
 */
export async function ingestAnalyticsBatch(
  db: AnalyticsD1Database,
  values: readonly unknown[],
  options: AnalyticsBatchOptions,
): Promise<AnalyticsIngestResult> {
  const quality = processAnalyticsBatch(values, options)
  const lateEvents = quality.outcomes.flatMap((outcome) =>
    outcome.quality === 'LATE' && outcome.event ? [outcome.event] : [],
  )
  const persistence = await persistAnalyticsEvents(db, quality.accepted, lateEvents)

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
    throw new Error('D1 duplicate results did not match batch event identities')
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
