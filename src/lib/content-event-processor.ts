import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'

const MAX_ATTEMPTS = 8
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 5 * 60_000
const PROCESSING_LEASE_MS = 5 * 60_000

export type ContentEventStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'

export type ContentEventRecord = {
  id: string | number
  eventId: string
  status: ContentEventStatus
  attempts: number
  sideEffects: unknown
  nextAttemptAt?: string | null
  processingStartedAt?: string | null
  processorId?: string | null
  lastError?: string | null
}

export type ContentEventProcessorResult = {
  claimed: number
  recovered: number
  processed: number
  failed: number
  skipped: number
}

function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS)
}

function normalizeEffects(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function isDue(nextAttemptAt: string | null | undefined, now: Date): boolean {
  if (!nextAttemptAt) return true
  const timestamp = Date.parse(nextAttemptAt)
  return Number.isNaN(timestamp) || timestamp <= now.getTime()
}

function isStaleProcessing(processingStartedAt: string | null | undefined, now: Date): boolean {
  if (!processingStartedAt) return true
  const timestamp = Date.parse(processingStartedAt)
  return Number.isNaN(timestamp) || timestamp + PROCESSING_LEASE_MS <= now.getTime()
}

export async function processContentEvents(args: {
  payload: Payload
  limit?: number
  executeSideEffect?: (effect: string, event: ContentEventRecord) => Promise<void>
  now?: Date
  processorId?: string
}): Promise<ContentEventProcessorResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
  const now = args.now ?? new Date()
  const nowIso = now.toISOString()
  const processorId = args.processorId ?? createProcessorInstanceId()
  const result: ContentEventProcessorResult = { claimed: 0, recovered: 0, processed: 0, failed: 0, skipped: 0 }

  const candidates = await args.payload.find({
    collection: 'content-events',
    where: {
      or: [
        { status: { equals: 'PENDING' } },
        { status: { equals: 'PROCESSING' } },
      ],
    },
    limit: Math.min(limit * 2, 200),
    sort: 'createdAt',
    depth: 0,
    overrideAccess: true,
  })

  for (const candidate of candidates.docs as unknown as ContentEventRecord[]) {
    const processing = candidate.status === 'PROCESSING'
    if (processing && !isStaleProcessing(candidate.processingStartedAt, now)) continue
    if (!processing && !isDue(candidate.nextAttemptAt, now)) continue

    const nextAttempts = Number(candidate.attempts ?? 0) + (processing ? 0 : 1)
    const claimed = await args.payload.update({
      collection: 'content-events',
      where: processing
        ? {
            and: [
              { id: { equals: candidate.id } },
              { status: { equals: 'PROCESSING' } },
              { processingStartedAt: candidate.processingStartedAt
                  ? { equals: candidate.processingStartedAt }
                  : { exists: false } },
            ],
          }
        : {
            and: [
              { id: { equals: candidate.id } },
              { status: { equals: 'PENDING' } },
              ...(candidate.nextAttemptAt ? [{ nextAttemptAt: { equals: candidate.nextAttemptAt } }] : []),
            ],
          },
      data: {
        status: 'PROCESSING',
        attempts: nextAttempts,
        processingStartedAt: nowIso,
        processorId,
        lastError: null,
      },
      overrideAccess: true,
      limit: 1,
    })

    if (claimed.docs.length !== 1) {
      result.skipped += 1
      continue
    }

    if (processing) result.recovered += 1
    else result.claimed += 1

    const event = claimed.docs[0] as unknown as ContentEventRecord
    const effects = normalizeEffects(event.sideEffects)

    try {
      for (const effect of effects) {
        if (args.executeSideEffect) await args.executeSideEffect(effect, event)
      }

      await args.payload.update({
        collection: 'content-events',
        where: {
          and: [
            { id: { equals: event.id } },
            { status: { equals: 'PROCESSING' } },
            { processorId: { equals: processorId } },
          ],
        },
        data: { status: 'PROCESSED', processedAt: nowIso, processingStartedAt: null, processorId: null, nextAttemptAt: null, lastError: null },
        overrideAccess: true,
        limit: 1,
      })
      result.processed += 1
    } catch (error) {
      const attempts = Number(event.attempts ?? 0)
      const message = error instanceof Error ? error.message : String(error)
      const exhausted = attempts >= MAX_ATTEMPTS
      const nextAttemptAt = exhausted ? null : new Date(now.getTime() + retryDelayMs(attempts)).toISOString()
      await args.payload.update({
        collection: 'content-events',
        where: {
          and: [
            { id: { equals: event.id } },
            { status: { equals: 'PROCESSING' } },
            { processorId: { equals: processorId } },
          ],
        },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          nextAttemptAt,
          processingStartedAt: null,
          processorId: null,
          lastError: message,
        },
        overrideAccess: true,
        limit: 1,
      })
      result.failed += 1
    }
  }

  return result
}

export function createContentEventIdempotencyKey(eventId: string, effect?: string): string {
  return effect ? `content-event:${eventId}:${effect}` : `content-event:${eventId}`
}

export function createProcessorInstanceId(): string {
  return randomUUID()
}
