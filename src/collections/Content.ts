import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { assertContentTransitionActor, buildContentStatePatch, resolveContentTransition, type ContentState } from '../lib/content-state-machine'

const contentTypes = ['article', 'post', 'video_metadata', 'gallery', 'live_metadata', 'series'] as const
const contentStates = ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'] as const

function sideEffectsForState(state: ContentState): string[] {
  if (state === 'PUBLISHED') return ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate']
  if (state === 'UNPUBLISHED' || state === 'DELETED') return ['feed.remove', 'search.remove', 'cache.invalidate']
  if (state === 'ARCHIVED') return ['feed.remove', 'search.remove']
  return []
}

export const Content: CollectionConfig = {
  slug: 'content',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'contentType', 'state', 'author', 'updatedAt'] },
  access: {
    read: ({ req }) => (req.user ? true : { state: { equals: 'PUBLISHED' } }),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (originalDoc && data.state !== undefined && data.state !== originalDoc.state && !req.context?.allowContentStateTransition) throw new APIError('Content state must be changed through the lifecycle transition API', 400)
        if (originalDoc && data.author !== undefined && String(data.author) !== String(originalDoc.author)) throw new APIError('Content author is immutable', 400)
        return data
      },
    ],
  },
  endpoints: [{
    path: '/:id/state',
    method: 'post',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const id = String(req.routeParams.id)
      const body = (await req.json()) as { to?: ContentState; expectedVersion?: number; expectedRevision?: number }
      if (!body.to || !contentStates.includes(body.to)) throw new APIError('A valid target state is required', 400)
      if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw new APIError('expectedVersion is required for optimistic concurrency', 400)
      if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) throw new APIError('expectedRevision is required for optimistic concurrency', 400)
      const current = await req.payload.findByID({ collection: 'content', id, depth: 0, overrideAccess: true, req })
      const currentState = current.state as ContentState
      const transition = resolveContentTransition(currentState, body.to)
      const authorId = typeof current.author === 'object' ? current.author.id : current.author
      assertContentTransitionActor({ transition, user: req.user as { id: string | number; role?: string | null; accountState?: any; permissions?: string[] | null; entitlements?: string[] | null }, authorId })
      if (Number(current.version) !== body.expectedVersion || Number(current.revision) !== body.expectedRevision) throw new APIError('Content version conflict; reload and retry', 409)
      const nextVersion = Number(current.version) + 1
      const nextRevision = Number(current.revision) + 1
      const now = new Date().toISOString()
      const sideEffects = sideEffectsForState(body.to)
      const eventId = randomUUID()
      const result = await req.payload.update({ collection: 'content', where: { and: [{ id: { equals: id } }, { version: { equals: body.expectedVersion } }, { revision: { equals: body.expectedRevision } }] }, data: { ...buildContentStatePatch(body.to, now), version: nextVersion, revision: nextRevision }, context: { allowContentStateTransition: true }, overrideAccess: true, req })
      if (!result.docs.length) throw new APIError('Content version conflict; reload and retry', 409)
      const updated = result.docs[0]
      const event = await req.payload.create({ collection: 'content-events', data: { eventId, content: id, event: transition.event, fromState: transition.from, toState: transition.to, actorId: String(req.user.id), permission: transition.permission, version: nextVersion, revision: nextRevision, sideEffects, status: 'PENDING', attempts: 0 }, overrideAccess: true, req })
      for (const effect of sideEffects) await req.payload.create({ collection: 'content-event-effects', data: { effectId: `content-event:${eventId}:${effect}`, eventId, contentEvent: event.id, effect, status: 'PENDING', attempts: 0 }, overrideAccess: true, req })
      return Response.json({ data: updated, eventId, transition: { from: transition.from, to: transition.to, permission: transition.permission, event: transition.event }, optimisticConcurrency: { previousVersion: body.expectedVersion, version: nextVersion, previousRevision: body.expectedRevision, revision: nextRevision }, sideEffects })
    },
    custom: { openapi: { summary: 'Transition content lifecycle state', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['to', 'expectedVersion', 'expectedRevision'], properties: { to: { type: 'string', enum: contentStates }, expectedVersion: { type: 'integer', minimum: 1 }, expectedRevision: { type: 'integer', minimum: 1 } } } } } }, responses: { 200: { description: 'Content state transitioned' }, 400: { description: 'Invalid transition request' }, 401: { description: 'Authentication required' }, 403: { description: 'Permission denied' }, 409: { description: 'Invalid transition or optimistic concurrency conflict' } } } },
  }],
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'contentType', type: 'select', required: true, options: contentTypes.map((value) => ({ label: value, value })), index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'DRAFT', options: contentStates.map((value) => ({ label: value, value })), index: true },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true },
    { name: 'excerpt', type: 'textarea', maxLength: 1000 },
    { name: 'bodyR2Key', type: 'text' },
    { name: 'coverMedia', type: 'relationship', relationTo: 'media' },
    { name: 'scheduledAt', type: 'date', index: true },
    { name: 'publishedAt', type: 'date', index: true },
    { name: 'archivedAt', type: 'date' },
    { name: 'deletedAt', type: 'date' },
    { name: 'version', type: 'number', required: true, defaultValue: 1, min: 1 },
    { name: 'revision', type: 'number', required: true, defaultValue: 1, min: 1 },
  ],
  timestamps: true,
}
