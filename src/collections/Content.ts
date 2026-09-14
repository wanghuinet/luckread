import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { assertOwnedPermission, assertPermission, hasPermission, type AuthorizationUser } from '../lib/authorization'
import {
  assertContentTransitionActor,
  assertWithinRestoreWindow,
  buildContentStatePatch,
  hasMaterialContentEdit,
  resolveContentTransition,
  type ContentState,
} from '../lib/content-state-machine'

const contentTypes = ['article', 'post', 'video_metadata', 'gallery', 'live_metadata', 'series'] as const
const contentStates = ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'] as const

function authorizationUser(reqUser: unknown): AuthorizationUser | null {
  if (!reqUser || typeof reqUser !== 'object') return null
  return reqUser as AuthorizationUser
}

function sideEffectsForState(state: ContentState): string[] {
  if (state === 'PUBLISHED') return ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate']
  if (state === 'UNPUBLISHED') return ['feed.remove', 'search.remove', 'cache.invalidate']
  if (state === 'DELETED') return ['feed.remove', 'search.remove', 'cache.invalidate', 'comment.anonymize']
  if (state === 'ARCHIVED') return ['feed.remove', 'search.remove']
  return []
}

function canModerate(user: AuthorizationUser | null): boolean {
  return hasPermission(user, 'moderation.decide')
}

export const Content: CollectionConfig = {
  slug: 'content',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'contentType', 'state', 'author', 'updatedAt'] },
  access: {
    read: ({ req }) => (req.user ? true : { state: { equals: 'PUBLISHED' } }),
    create: ({ req }) => Boolean(req.user) && hasPermission(authorizationUser(req.user), 'content.update.own'),
    update: ({ req }) => {
      const user = authorizationUser(req.user)
      if (!user) return false
      if (canModerate(user)) return true
      return { author: { equals: user.id } }
    },
    delete: ({ req }) => {
      const user = authorizationUser(req.user)
      if (!user) return false
      if (canModerate(user)) return true
      return { author: { equals: user.id } }
    },
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (originalDoc && data.state !== undefined && data.state !== originalDoc.state && !req.context?.allowContentStateTransition) {
          throw new APIError('Content state must be changed through the lifecycle transition API', 400)
        }
        if (originalDoc && data.author !== undefined && String(data.author) !== String(originalDoc.author)) {
          throw new APIError('Content author is immutable', 400)
        }
        if (originalDoc?.state === 'PUBLISHED' && hasMaterialContentEdit(data as Record<string, unknown>, originalDoc as Record<string, unknown>)) {
          throw new APIError('Material edits to published content require PUBLISHED -> PENDING_REVIEW before editing', 409)
        }
        if (originalDoc?.state === 'DELETED' && data.state !== 'RESTORED' && data.state !== undefined) {
          throw new APIError('Deleted content can only be restored through the lifecycle API', 409)
        }
        if (req.context?.systemJob && !req.context.allowContentStateTransition) {
          throw new APIError('System job context cannot mutate content directly', 403)
        }
        return data
      },
    ],
  },
  endpoints: [{
    path: '/:id/state',
    method: 'post',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const user = authorizationUser(req.user)
      const id = String(req.routeParams.id)
      const body = (await req.json()) as { to?: ContentState; expectedVersion?: number; expectedRevision?: number }
      if (!body.to || !contentStates.includes(body.to)) throw new APIError('A valid target state is required', 400)
      if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) throw new APIError('expectedVersion is required for optimistic concurrency', 400)
      if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) throw new APIError('expectedRevision is required for optimistic concurrency', 400)

      const current = await req.payload.findByID({ collection: 'content', id, depth: 0, overrideAccess: true, req })
      const currentState = current.state as ContentState
      const transition = resolveContentTransition(currentState, body.to)
      const authorId = typeof current.author === 'object' ? current.author.id : current.author

      if (transition.actor === 'system') {
        throw new APIError('System-only transition', 403)
      }
      assertContentTransitionActor({ transition, user, authorId })

      if (transition.precondition === 'within_restore_window') {
        assertWithinRestoreWindow(current.deletedAt)
      }

      if (Number(current.version) !== body.expectedVersion || Number(current.revision) !== body.expectedRevision) {
        throw new APIError('Content version conflict; reload and retry', 409)
      }

      const nextVersion = Number(current.version) + 1
      const nextRevision = Number(current.revision) + 1
      const now = new Date().toISOString()
      const sideEffects = sideEffectsForState(body.to)
      const eventId = randomUUID()
      const result = await req.payload.update({
        collection: 'content',
        where: {
          and: [
            { id: { equals: id } },
            { version: { equals: body.expectedVersion } },
            { revision: { equals: body.expectedRevision } },
          ],
        },
        data: { ...buildContentStatePatch(body.to, now), version: nextVersion, revision: nextRevision },
        context: { allowContentStateTransition: true },
        overrideAccess: true,
        req,
      })
      if (!result.docs.length) throw new APIError('Content version conflict; reload and retry', 409)

      const updated = result.docs[0]
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
        data: updated,
        eventId,
        transition: { from: transition.from, to: transition.to, permission: transition.permission, event: transition.event },
        optimisticConcurrency: { previousVersion: body.expectedVersion, version: nextVersion, previousRevision: body.expectedRevision, revision: nextRevision },
        sideEffects,
      })
    },
    custom: {
      openapi: {
        summary: 'Transition content lifecycle state',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['to', 'expectedVersion', 'expectedRevision'],
                properties: {
                  to: { type: 'string', enum: contentStates },
                  expectedVersion: { type: 'integer', minimum: 1 },
                  expectedRevision: { type: 'integer', minimum: 1 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Content state transitioned' },
          400: { description: 'Invalid transition request' },
          401: { description: 'Authentication required' },
          403: { description: 'Permission denied' },
          409: { description: 'Invalid transition, lifecycle precondition, or optimistic concurrency conflict' },
        },
      },
    },
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
