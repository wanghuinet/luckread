import { randomUUID } from 'node:crypto'
import type { Payload } from 'payload'

const MAX_ATTEMPTS = 8
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 5 * 60_000

export type ContentEventStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED'

export type ContentEventRecord = {
  id: string | number
  eventId: string
  status: ContentEventStatus
  attempts: number
  sideEffects: unknown
  lastError?: string | null
}

export type ContentEventProcessorResult = {
  claimed: number
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

export async function processContentEvents(args: {
  payload: Payload
  limit?: number
  executeSideEffect?: (effect: string, event: ContentEventRecord) => Promise<void>
  now?: Date
}): Promise<ContentEventProcessorResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
  const now = args.now ?? new Date()
  const nowIso = now.toISOString()
  const result: ContentEventProcessorResult = { claimed: 0, processed: 0, failed: 0, skipped: 0 }

  const pending = await args.payload.find({
    collection: 'content-events',
    where: { status: { equals: 'PENDING' } },
    limit,
    sort: 'createdAt',
    depth: 0,
    overrideAccess: true,
  })

  for (const candidate of pending.docs as unknown as ContentEventRecord[]) {
    const claimed = await args.payload.update({
      collection: 'content-events',
      where: { id: { equals: candidate.id }, status: { equals: 'PENDING' } },
      data: { status: 'PROCESSING', attempts: Number(candidate.attempts ?? 0) + 1 },
      overrideAccess: true,
      limit: 1,
    })

    if (claimed.docs.length !== 1) {
      result.skipped += 1
      continue
    }

    result.claimed += 1
    const event = claimed.docs[0] as unknown as ContentEventRecord
    const effects = normalizeEffects(event.sideEffects)

    try {
      for (const effect of effects) {
        if (args.executeSideEffect) await args.executeSideEffect(effect, event)
      }

      await args.payload.update({
        collection: 'content-events',
        where: { id: { equals: event.id }, status: { equals: 'PROCESSING' } },
        data: { status: 'PROCESSED', processedAt: nowIso, lastError: null },
        overrideAccess: true,
        limit: 1,
      })
      result.processed += 1
    } catch (error) {
      const attempts = Number(event.attempts ?? 0)
      const message = error instanceof Error ? error.message : String(error)
      const exhausted = attempts >= MAX_ATTEMPTS
      await args.payload.update({
        collection: 'content-events',
        where: { id: { equals: event.id }, status: { equals: 'PROCESSING' } },
        data: {
          status: exhausted ? 'FAILED' : 'PENDING',
          lastError: `${message} (retryAfterMs=${exhausted ? 0 : retryDelayMs(attempts)})`,
        },
        overrideAccess: true,
        limit: 1,
      })
      result.failed += 1
    }
  }

  return result
}

export function createContentEventIdempotencyKey(eventId: string): string {
  return `content-event:${eventId}`
}

export function createProcessorInstanceId(): string {
  return randomUUID()
}
