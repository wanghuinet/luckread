import { randomUUID } from 'node:crypto'
import { APIError, type PayloadRequest } from 'payload'

import { assertContentTransitionActor, assertWithinRestoreWindow, buildContentStatePatch, resolveContentTransition, type ContentState } from './content-state-machine'
import { type AuthorizationUser } from './authorization'

const CONTENT_STATES = ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'] as const

type TransitionBody = { expectedVersion?: number; expectedRevision?: number }

function toAuthorizationUser(value: unknown): AuthorizationUser | null {
  if (!value || typeof value !== 'object') return null
  return value as AuthorizationUser
}

function sideEffectsForState(state: ContentState): string[] {
  if (state === 'PUBLISHED') return ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate']
  if (state === 'UNPUBLISHED') return ['feed.remove', 'search.remove', 'cache.invalidate']
  if (state === 'DELETED') return ['feed.remove', 'search.remove', 'cache.invalidate', 'comment.anonymize']
  if (state === 'ARCHIVED') return ['feed.remove', 'search.remove']
  return []
}

export async function transitionContentState(req: PayloadRequest, to: ContentState, parsedBody?: TransitionBody): Promise<Response> {
  if (!req.user) throw new APIError('Authentication required', 401)
  if (!CONTENT_STATES.includes(to)) throw new APIError('A valid target state is required', 400)

  const body = parsedBody ?? (await req.json() as TransitionBody)
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw new APIError('expectedVersion is required for optimistic concurrency', 400)
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) throw new APIError('expectedRevision is required for optimistic concurrency', 400)

  const id = String(req.routeParams.id)
  const current = await req.payload.findByID({ collection: 'content', id, depth: 0, overrideAccess: true, req })
  const currentState = current.state as ContentState
  const transition = resolveContentTransition(currentState, to)
  const user = toAuthorizationUser(req.user)
  const authorId = typeof current.author === 'object' ? current.author.id : current.author

  assertContentTransitionActor({ transition, user, authorId })
  if (transition.actor === 'system') throw new APIError('System-only transition', 403)
  if (transition.precondition === 'within_restore_window') assertWithinRestoreWindow(current.deletedAt)

  if (Number(current.version) !== body.expectedVersion || Number(current.revision) !== body.expectedRevision) {
    throw new APIError('Content version conflict; reload and retry', 409)
  }

  const nextVersion = Number(current.version) + 1
  const nextRevision = Number(current.revision) + 1
  const now = new Date().toISOString()
  const sideEffects = sideEffectsForState(to)
  const eventId = randomUUID()
  const result = await req.payload.update({
    collection: 'content',
    where: { and: [{ id: { equals: id } }, { state: { equals: currentState } }, { version: { equals: body.expectedVersion } }, { revision: { equals: body.expectedRevision } }] },
    data: { ...buildContentStatePatch(to, now), version: nextVersion, revision: nextRevision },
    context: { allowContentStateTransition: true },
    overrideAccess: true,
    limit: 1,
    req,
  })
  if (result.docs.length !== 1) throw new APIError('Content version conflict; reload and retry', 409)

  const event = await req.payload.create({
    collection: 'content-events',
    data: {
      eventId,
      content: id,
      event: transition.event,
      fromState: transition.from,
      toState: transition.to,
      actorId: String(user?.id),
      permission: transition.permission,
      version: nextVersion,
      revision: nextRevision,
      sideEffects,
      status: 'PENDING',
      attempts: 0,
    },
    overrideAccess: true,
    req,
  })
  for (const effect of sideEffects) {
    await req.payload.create({
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
      req,
    })
  }

  return Response.json({
    data: result.docs[0],
    eventId,
    transition: { from: transition.from, to: transition.to, permission: transition.permission, event: transition.event },
    optimisticConcurrency: { previousVersion: body.expectedVersion, version: nextVersion, previousRevision: body.expectedRevision, revision: nextRevision },
    sideEffects,
  })
}
