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
  return { quality, persistence }
}
