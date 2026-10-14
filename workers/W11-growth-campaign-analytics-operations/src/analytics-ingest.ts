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
  const persistence = await persistAnalyticsEvents(db, quality.accepted)
  if (persistence.duplicateEventIds.length === 0) return { quality, persistence }

  const duplicateIds = new Set(persistence.duplicateEventIds)
  const acceptedIds = new Set(quality.accepted.map((event) => event.eventId))
  if (
    duplicateIds.size !== persistence.duplicateEventIds.length ||
    persistence.duplicateEventIds.some((eventId) => !acceptedIds.has(eventId))
  ) {
    throw new Error('D1 duplicate results did not match accepted event identities')
  }

  const duplicateCount = duplicateIds.size
  const reconciledQuality: AnalyticsBatchResult = {
    ...quality,
    accepted: quality.accepted.filter((event) => !duplicateIds.has(event.eventId)),
    outcomes: quality.outcomes.map((outcome) => {
      const eventId = outcome.event?.eventId
      if (outcome.quality !== 'VALID' || !eventId || !duplicateIds.has(eventId)) {
        return outcome
      }
      return {
        ...outcome,
        quality: 'DUPLICATE',
        reason: 'PERSISTED_EVENT_ID_OR_DEDUPE_KEY',
      }
    }),
    counts: {
      ...quality.counts,
      VALID: quality.counts.VALID - duplicateCount,
      DUPLICATE: quality.counts.DUPLICATE + duplicateCount,
    },
  }

  return { quality: reconciledQuality, persistence }
}
