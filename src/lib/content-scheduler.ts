import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { Payload } from 'payload'

import { buildContentStatePatch, resolveContentTransition } from './content-state-machine'

export type ContentSchedulerResult = {
  claimed: number
  published: number
  skipped: number
}

export async function publishScheduledContent(args: {
  payload: Payload
  limit?: number
  now?: Date
}): Promise<ContentSchedulerResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
  const now = args.now ?? new Date()
  const nowIso = now.toISOString()
  const result: ContentSchedulerResult = { claimed: 0, published: 0, skipped: 0 }

  const due = await args.payload.find({
    collection: 'content',
    where: {
      and: [
        { state: { equals: 'SCHEDULED' } },
        { scheduledAt: { less_than_equal: nowIso } },
      ],
    },
    limit,
    sort: 'scheduledAt',
    depth: 0,
    overrideAccess: true,
  })

  for (const candidate of due.docs as Array<{ id: string | number; state: string; version: number; revision: number }>) {
    if (candidate.state !== 'SCHEDULED') {
      result.skipped += 1
      continue
    }

    const transition = resolveContentTransition('SCHEDULED', 'PUBLISHED')
    const nextVersion = Number(candidate.version) + 1
    const nextRevision = Number(candidate.revision) + 1
    const eventId = randomUUID()

    const updated = await args.payload.update({
      collection: 'content',
      where: {
        and: [
          { id: { equals: candidate.id } },
          { state: { equals: 'SCHEDULED' } },
          { version: { equals: candidate.version } },
          { revision: { equals: candidate.revision } },
        ],
      },
      data: {
        ...buildContentStatePatch('PUBLISHED', nowIso),
        version: nextVersion,
        revision: nextRevision,
      },
      context: { allowContentStateTransition: true, systemJob: true },
      overrideAccess: true,
      limit: 1,
    })

    if (updated.docs.length !== 1) {
      result.skipped += 1
      continue
    }
    result.claimed += 1

    try {
      const event = await args.payload.create({
        collection: 'content-events',
        data: {
          eventId,
          content: candidate.id,
          event: transition.event,
          fromState: transition.from,
          toState: transition.to,
          actorId: 'system:scheduler',
          permission: transition.permission,
          version: nextVersion,
          revision: nextRevision,
          sideEffects: ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate'],
          status: 'PENDING',
          attempts: 0,
        },
        overrideAccess: true,
      })

      const effects = ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate']
      for (const effect of effects) {
        await args.payload.create({
          collection: 'content-event-effects',
          data: {
            effectId: `content-event:${eventId}:${effect}`,
            eventId,
            contentEvent: event.id,
            effect,
            status: 'PENDING',
            attempts: 0,
          },
          overrideAccess: true,
        })
      }
      result.published += 1
    } catch (error) {
      throw new APIError(`Scheduled publication outbox creation failed: ${error instanceof Error ? error.message : String(error)}`, 500)
    }
  }

  return result
}
