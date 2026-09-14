import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'

const MAX_ATTEMPTS = 8
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 5 * 60_000
const PROCESSING_LEASE_MS = 5 * 60_000

export type ContentEventEffectStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'

type EffectRecord = {
  id: string | number
  effectId: string
  eventId: string
  effect: string
  status: ContentEventEffectStatus
  attempts: number
  nextAttemptAt?: string | null
  processingStartedAt?: string | null
  processorId?: string | null
  lastError?: string | null
}

export type ContentEventEffectProcessorResult = {
  claimed: number
  recovered: number
  processed: number
  failed: number
  skipped: number
}

function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS)
}

function due(value: string | null | undefined, now: Date): boolean {
  if (!value) return true
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) || timestamp <= now.getTime()
}

function stale(value: string | null | undefined, now: Date): boolean {
  if (!value) return true
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) || timestamp + PROCESSING_LEASE_MS <= now.getTime()
}

export async function processContentEventEffects(args: {
  payload: Payload
  limit?: number
  executeEffect?: (effect: string, eventId: string, effectId: string) => Promise<void>
  now?: Date
  processorId?: string
}): Promise<ContentEventEffectProcessorResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
  const now = args.now ?? new Date()
  const nowIso = now.toISOString()
  const processorId = args.processorId ?? randomUUID()
  const result: ContentEventEffectProcessorResult = { claimed: 0, recovered: 0, processed: 0, failed: 0, skipped: 0 }

  const candidates = await args.payload.find({
    collection: 'content-event-effects',
    where: { or: [{ status: { equals: 'PENDING' } }, { status: { equals: 'PROCESSING' } }] },
    limit: Math.min(limit * 2, 200),
    sort: 'createdAt',
    depth: 0,
    overrideAccess: true,
  })

  for (const candidate of candidates.docs as unknown as EffectRecord[]) {
    const recovering = candidate.status === 'PROCESSING'
    if (recovering ? !stale(candidate.processingStartedAt, now) : !due(candidate.nextAttemptAt, now)) continue

    const attempts = Number(candidate.attempts ?? 0) + (recovering ? 0 : 1)
    const claimed = await args.payload.update({
      collection: 'content-event-effects',
      where: recovering
        ? {
            and: [
              { id: { equals: candidate.id } },
              { status: { equals: 'PROCESSING' } },
              { processingStartedAt: candidate.processingStartedAt ? { equals: candidate.processingStartedAt } : { exists: false } },
            ],
          }
        : {
            and: [
              { id: { equals: candidate.id } },
              { status: { equals: 'PENDING' } },
              ...(candidate.nextAttemptAt ? [{ nextAttemptAt: { equals: candidate.nextAttemptAt } }] : []),
            ],
          },
      data: { status: 'PROCESSING', attempts, processingStartedAt: nowIso, processorId, lastError: null },
      overrideAccess: true,
      limit: 1,
    })

    if (claimed.docs.length !== 1) {
      result.skipped += 1
      continue
    }

    if (recovering) result.recovered += 1
    else result.claimed += 1

    const event = claimed.docs[0] as unknown as EffectRecord
    try {
      if (args.executeEffect) await args.executeEffect(event.effect, event.eventId, event.effectId)
      await args.payload.update({
        collection: 'content-event-effects',
        where: { and: [{ id: { equals: event.id } }, { status: { equals: 'PROCESSING' } }, { processorId: { equals: processorId } }] },
        data: { status: 'PROCESSED', processedAt: nowIso, processingStartedAt: null, processorId: null, nextAttemptAt: null, lastError: null },
        overrideAccess: true,
        limit: 1,
      })
      result.processed += 1
    } catch (error) {
      const attemptCount = Number(event.attempts ?? 0)
      const message = error instanceof Error ? error.message : String(error)
      const exhausted = attemptCount >= MAX_ATTEMPTS
      await args.payload.update({
        collection: 'content-event-effects',
        where: { and: [{ id: { equals: event.id } }, { status: { equals: 'PROCESSING' } }, { processorId: { equals: processorId } }] },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelayMs(attemptCount)).toISOString(),
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
