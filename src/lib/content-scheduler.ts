import { randomUUID } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'

import { buildContentStatePatch, resolveContentTransition } from './content-state-machine'
import { generateContentPaywall } from './content-paywall-service'

const PUBLISH_EFFECTS = ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate'] as const

type ScheduledCandidate = { id: string | number; state: string; version: number; revision: number }

export type ContentSchedulerResult = { claimed: number; published: number; skipped: number }

export async function publishScheduledContent(args: { payload: Payload; req?: PayloadRequest; limit?: number; now?: Date }): Promise<ContentSchedulerResult> {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 100))
  const now = args.now ?? new Date()
  const nowIso = now.toISOString()
  const result: ContentSchedulerResult = { claimed: 0, published: 0, skipped: 0 }

  const due = await args.payload.find({
    collection: 'content',
    where: { and: [{ state: { equals: 'SCHEDULED' } }, { scheduledAt: { less_than_equal: nowIso } }] },
    limit,
    sort: 'scheduledAt',
    depth: 0,
    overrideAccess: true,
    ...(args.req ? { req: args.req } : {}),
  })

  for (const candidate of due.docs as ScheduledCandidate[]) {
    let transactionID: string | number | undefined
    let req = args.req
    if (!req) {
      transactionID = await args.payload.db.beginTransaction()
      req = { transactionID } as PayloadRequest
    }

    try {
      const transition = resolveContentTransition('SCHEDULED', 'PUBLISHED')
      const nextVersion = Number(candidate.version) + 1
      const nextRevision = Number(candidate.revision) + 1
      const eventId = randomUUID()

      const updated = await args.payload.update({
        collection: 'content',
        where: { and: [{ id: { equals: candidate.id } }, { state: { equals: 'SCHEDULED' } }, { version: { equals: candidate.version } }, { revision: { equals: candidate.revision } }] },
        data: { ...buildContentStatePatch('PUBLISHED', nowIso), version: nextVersion, revision: nextRevision },
        context: { allowContentStateTransition: true, systemJob: true },
        overrideAccess: true,
        limit: 1,
        req,
      })

      if (updated.docs.length !== 1) {
        if (transactionID !== undefined) await args.payload.db.rollbackTransaction(transactionID)
        result.skipped += 1
        continue
      }

      const publishedDoc = updated.docs[0] as unknown as Record<string, unknown>
      if (publishedDoc.paywallMode === 'SUBSCRIPTION_PREVIEW') await generateContentPaywall(req, publishedDoc)

      const event = await args.payload.create({
        collection: 'content-events',
        data: { eventId, content: candidate.id, event: transition.event, fromState: transition.from, toState: transition.to, actorId: 'system:scheduler', permission: transition.permission, version: nextVersion, revision: nextRevision, sideEffects: [...PUBLISH_EFFECTS], status: 'PENDING', attempts: 0 },
        overrideAccess: true,
        req,
      })
      for (const effect of PUBLISH_EFFECTS) {
        await args.payload.create({
          collection: 'content-event-effects',
          data: { effectId: `content-event:${eventId}:${effect}`, eventId, contentEvent: event.id, effect, status: 'PENDING', attempts: 0 },
          overrideAccess: true,
          req,
        })
      }

      if (transactionID !== undefined) await args.payload.db.commitTransaction(transactionID)
      result.claimed += 1
      result.published += 1
    } catch (error) {
      if (transactionID !== undefined) await args.payload.db.rollbackTransaction(transactionID)
      throw error
    }
  }

  return result
}
