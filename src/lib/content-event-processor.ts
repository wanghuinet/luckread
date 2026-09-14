import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'

const MAX_ATTEMPTS = 8
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 5 * 60_000
const PROCESSING_LEASE_MS = 5 * 60_000

export type ContentEventStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'
export type ContentEffectStatus = ContentEventStatus

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

export type ContentEffectRecord = {
  id: string | number
  effectId: string
  eventId: string
  effect: string
  status: ContentEffectStatus
  attempts: number
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

async function refreshEventStatus(payload: Payload, eventId: string, nowIso: string): Promise<void> {
  const effects = await payload.find({
    collection: 'content-event-effects',
    where: { eventId: { equals: eventId } },
    limit: 100,
    depth: 0,
    overrideAccess: true,
  })
  const records = effects.docs as unknown as Array<{ status: ContentEffectStatus }>
  const hasFailed = records.some((effect) => effect.status === 'FAILED')
  const allProcessed = records.length > 0 && records.every((effect) => effect.status === 'PROCESSED')
  const hasProcessing = records.some((effect) => effect.status === 'PROCESSING')
  const status: ContentEventStatus = allProcessed ? 'PROCESSED' : hasFailed ? 'FAILED' : hasProcessing ? 'PROCESSING' : 'PENDING'

  await payload.update({
    collection: 'content-events',
    where: { and: [{ eventId: { equals: eventId } }, { status: { not_equals: 'PROCESSED' } }] },
    data: {
      status,
      ...(status === 'PROCESSED' ? { processedAt: nowIso, processingStartedAt: null, processorId: null, nextAttemptAt: null, lastError: null } : {}),
    },
    overrideAccess: true,
    limit: 1,
  })
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
    collection: 'content-event-effects',
    where: { or: [{ status: { equals: 'PENDING' } }, { status: { equals: 'PROCESSING' } }] },
    limit: Math.min(limit * 2, 200),
    sort: 'createdAt',
    depth: 0,
    overrideAccess: true,
  })

  for (const candidate of candidates.docs as unknown as ContentEffectRecord[]) {
    const processing = candidate.status === 'PROCESSING'
    if (processing && !isStaleProcessing(candidate.processingStartedAt, now)) continue
    if (!processing && !isDue(candidate.nextAttemptAt, now)) continue

    const nextAttempts = Number(candidate.attempts ?? 0) + (processing ? 0 : 1)
    const claimed = await args.payload.update({
      collection: 'content-event-effects',
      where: processing
        ? {
            and: [
              { id: { equals: candidate.id } },
              { status: { equals: 'PROCESSING' } },
              ...(candidate.processingStartedAt ? [{ processingStartedAt: { equals: candidate.processingStartedAt } }] : [{ processingStartedAt: { exists: false } }]),
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

    const effect = claimed.docs[0] as unknown as ContentEffectRecord
    const parentEvent = await args.payload.find({
      collection: 'content-events',
      where: { eventId: { equals: effect.eventId } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    const event = parentEvent.docs[0] as unknown as ContentEventRecord | undefined
    if (!event) {
      await args.payload.update({
        collection: 'content-event-effects',
        where: { and: [{ id: { equals: effect.id } }, { status: { equals: 'PROCESSING' } }, { processorId: { equals: processorId } }] },
        data: { status: 'FAILED', lastError: 'Parent content event not found', processingStartedAt: null, processorId: null },
        overrideAccess: true,
        limit: 1,
      })
      result.failed += 1
      continue
    }

    try {
      if (args.executeSideEffect) await args.executeSideEffect(effect.effect, event)

      await args.payload.update({
        collection: 'content-event-effects',
        where: { and: [{ id: { equals: effect.id } }, { status: { equals: 'PROCESSING' } }, { processorId: { equals: processorId } }] },
        data: { status: 'PROCESSED', processedAt: nowIso, processingStartedAt: null, processorId: null, nextAttemptAt: null, lastError: null },
        overrideAccess: true,
        limit: 1,
      })
      await refreshEventStatus(args.payload, effect.eventId, nowIso)
      result.processed += 1
    } catch (error) {
      const attempts = Number(effect.attempts ?? 0)
      const message = error instanceof Error ? error.message : String(error)
      const exhausted = attempts >= MAX_ATTEMPTS
      const nextAttemptAt = exhausted ? null : new Date(now.getTime() + retryDelayMs(attempts)).toISOString()
      await args.payload.update({
        collection: 'content-event-effects',
        where: { and: [{ id: { equals: effect.id } }, { status: { equals: 'PROCESSING' } }, { processorId: { equals: processorId } }] },
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
      await refreshEventStatus(args.payload, effect.eventId, nowIso)
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
