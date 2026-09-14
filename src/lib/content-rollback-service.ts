import { APIError, type PayloadRequest } from 'payload'
import { randomUUID } from 'node:crypto'

import { hasPermission, type AuthorizationUser } from './authorization'

function relationshipId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
  }
  return undefined
}

type RollbackBody = { revision: number; expectedVersion: number; expectedRevision: number }

export async function rollbackContent(req: PayloadRequest, body: RollbackBody): Promise<Response> {
  if (!req.user) throw new APIError('Authentication required', 401)
  if (!Number.isInteger(body.revision) || body.revision < 1) throw new APIError('revision is required', 400)
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw new APIError('expectedVersion is required', 400)
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) throw new APIError('expectedRevision is required', 400)

  const user = req.user as AuthorizationUser
  if (!hasPermission(user, 'content.update.own') && !hasPermission(user, 'moderation.decide')) {
    throw new APIError('Content rollback permission denied', 403)
  }

  const id = String(req.routeParams.id)
  const current = await req.payload.findByID({ collection: 'content', id, depth: 0, overrideAccess: true, req })
  const ownerId = relationshipId(current.author)
  const isModerator = hasPermission(user, 'moderation.decide')
  if (!isModerator && ownerId !== String(user.id)) throw new APIError('Content ownership permission denied', 403)
  if (Number(current.version) !== body.expectedVersion || Number(current.revision) !== body.expectedRevision) {
    throw new APIError('Content version conflict; reload and retry', 409)
  }

  const revisions = await req.payload.find({
    collection: 'content-revisions',
    where: { and: [{ content: { equals: id } }, { revision: { equals: body.revision } }] },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  const source = revisions.docs[0]
  if (!source) throw new APIError('Requested content revision was not found', 404)
  if (body.revision >= Number(current.revision)) throw new APIError('Rollback target must be an older revision', 400)

  const snapshot = source.snapshot as Record<string, unknown>
  const nextVersion = Number(current.version) + 1
  const nextRevision = Number(current.revision) + 1
  const nextState = current.state === 'PUBLISHED' ? 'PENDING_REVIEW' : current.state
  const result = await req.payload.update({
    collection: 'content',
    where: { and: [{ id: { equals: id } }, { version: { equals: body.expectedVersion } }, { revision: { equals: body.expectedRevision } }] },
    data: {
      title: snapshot.title,
      slug: snapshot.slug,
      contentType: snapshot.contentType,
      locale: snapshot.locale,
      excerpt: snapshot.excerpt,
      bodyR2Key: snapshot.bodyR2Key,
      coverMedia: snapshot.coverMedia,
      state: nextState,
      version: nextVersion,
      revision: nextRevision,
    },
    context: { allowContentStateTransition: true },
    overrideAccess: true,
    limit: 1,
    req,
  })
  if (result.docs.length !== 1) throw new APIError('Content version conflict; reload and retry', 409)

  const eventId = randomUUID()
  await req.payload.create({
    collection: 'content-events',
    data: {
      eventId,
      content: id,
      event: 'CONTENT_ROLLBACK',
      fromState: current.state,
      toState: nextState,
      actorId: String(user.id),
      permission: 'content.update.own',
      version: nextVersion,
      revision: nextRevision,
      sideEffects: nextState === 'PENDING_REVIEW' ? ['search.remove', 'feed.remove', 'cache.invalidate'] : ['cache.invalidate'],
      status: 'PENDING',
      attempts: 0,
    },
    overrideAccess: true,
    req,
  })

  return Response.json({ data: result.docs[0], eventId, rolledBackFromRevision: body.revision, newRevision: nextRevision, newVersion: nextVersion, state: nextState })
}
