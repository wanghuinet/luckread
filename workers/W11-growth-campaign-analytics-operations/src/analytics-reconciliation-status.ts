export interface AnalyticsRebuildStatusStatement {
  first(): Promise<Record<string, unknown> | null>
}

export interface AnalyticsRebuildStatusDatabase {
  prepare(query: string): AnalyticsRebuildStatusStatement
}

export type AnalyticsProjectionRebuildStatus =
  | {
      runId: string
      hourStart: string
      status: 'RUNNING'
      startedAt: string
      completedAt: null
      contentBucketsRebuilt: null
      creatorBucketsRebuilt: null
      errorCode: null
    }
  | {
      runId: string
      hourStart: string
      status: 'SUCCEEDED'
      startedAt: string
      completedAt: string
      contentBucketsRebuilt: number
      creatorBucketsRebuilt: number
      errorCode: null
    }
  | {
      runId: string
      hourStart: string
      status: 'FAILED'
      startedAt: string
      completedAt: string
      contentBucketsRebuilt: number | null
      creatorBucketsRebuilt: number | null
      errorCode:
        | 'REBUILD_FAILED'
        | 'REBUILD_BATCH_INCOMPLETE'
        | 'REBUILD_FINALIZE_FAILED'
    }

const LATEST_REBUILD_STATUS_SQL = `
SELECT
  run_id,
  hour_start,
  status,
  started_at,
  completed_at,
  content_buckets_rebuilt,
  creator_buckets_rebuilt,
  error_code
FROM analytics_projection_rebuild_state
WHERE singleton_id = 1
LIMIT 1
`

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANONICAL_UTC_MILLIS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const VALID_ERROR_CODES = new Set([
  'REBUILD_FAILED',
  'REBUILD_BATCH_INCOMPLETE',
  'REBUILD_FINALIZE_FAILED',
])

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !CANONICAL_UTC_MILLIS.test(value)) return false
  const instant = Date.parse(value)
  return Number.isFinite(instant) && new Date(instant).toISOString() === value
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0
}

function invalidStatus(): never {
  // Do not surface stored provider values or internal database details.
  throw new Error('Stored analytics projection rebuild status is invalid')
}

/**
 * Read the latest bounded repair marker for recovery after a caller timeout,
 * retry, or process restart. No HTTP surface or authorization policy is created
 * here; the consuming runtime must enforce access before exposing this state.
 */
export async function getLatestAnalyticsProjectionRebuildStatus(
  db: AnalyticsRebuildStatusDatabase,
): Promise<AnalyticsProjectionRebuildStatus | null> {
  const row = await db.prepare(LATEST_REBUILD_STATUS_SQL).first()
  if (!row) return null

  if (
    typeof row.run_id !== 'string' ||
    !UUID_PATTERN.test(row.run_id) ||
    typeof row.hour_start !== 'string' ||
    typeof row.status !== 'string' ||
    !isCanonicalInstant(row.started_at) ||
    !/\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z/.test(row.hour_start)
  ) {
    return invalidStatus()
  }

  const hourMs = Date.parse(row.hour_start)
  if (
    !Number.isFinite(hourMs) ||
    new Date(hourMs).toISOString() !== row.hour_start
  ) {
    return invalidStatus()
  }

  const base = {
    runId: row.run_id,
    hourStart: row.hour_start,
    startedAt: row.started_at,
  }

  if (row.status === 'RUNNING') {
    if (
      row.completed_at !== null ||
      row.content_buckets_rebuilt !== null ||
      row.creator_buckets_rebuilt !== null ||
      row.error_code !== null
    ) {
      return invalidStatus()
    }
    return {
      ...base,
      status: 'RUNNING',
      completedAt: null,
      contentBucketsRebuilt: null,
      creatorBucketsRebuilt: null,
      errorCode: null,
    }
  }

  if (row.status === 'SUCCEEDED') {
    if (
      !isCanonicalInstant(row.completed_at) ||
      !isNonNegativeSafeInteger(row.content_buckets_rebuilt) ||
      !isNonNegativeSafeInteger(row.creator_buckets_rebuilt) ||
      row.error_code !== null
    ) {
      return invalidStatus()
    }
    return {
      ...base,
      status: 'SUCCEEDED',
      completedAt: row.completed_at,
      contentBucketsRebuilt: row.content_buckets_rebuilt,
      creatorBucketsRebuilt: row.creator_buckets_rebuilt,
      errorCode: null,
    }
  }

  if (row.status === 'FAILED') {
    if (
      !isCanonicalInstant(row.completed_at) ||
      (row.content_buckets_rebuilt !== null &&
        !isNonNegativeSafeInteger(row.content_buckets_rebuilt)) ||
      (row.creator_buckets_rebuilt !== null &&
        !isNonNegativeSafeInteger(row.creator_buckets_rebuilt)) ||
      typeof row.error_code !== 'string' ||
      !VALID_ERROR_CODES.has(row.error_code)
    ) {
      return invalidStatus()
    }
    return {
      ...base,
      status: 'FAILED',
      completedAt: row.completed_at,
      contentBucketsRebuilt: row.content_buckets_rebuilt as number | null,
      creatorBucketsRebuilt: row.creator_buckets_rebuilt as number | null,
      errorCode: row.error_code as
        | 'REBUILD_FAILED'
        | 'REBUILD_BATCH_INCOMPLETE'
        | 'REBUILD_FINALIZE_FAILED',
    }
  }

  return invalidStatus()
}
