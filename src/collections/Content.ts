import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import {
  assertContentTransitionActor,
  buildContentStatePatch,
  resolveContentTransition,
  type ContentState,
} from '../lib/content-state-machine'

const contentTypes = ['article', 'post', 'video_metadata', 'gallery', 'live_metadata', 'series'] as const
const contentStates = [
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
  'DELETED',
  'RESTORED',
] as const

export const Content: CollectionConfig = {
  slug: 'content',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'contentType', 'state', 'author', 'updatedAt'],
  },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      return { state: { equals: 'PUBLISHED' } }
    },
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
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
        return data
      },
    ],
  },
  endpoints: [
    {
      path: '/:id/state',
      method: 'post',
      handler: async (req) => {
        if (!req.user) throw new APIError('Authentication required', 401)

        const id = String(req.routeParams.id)
        const body = (await req.json()) as {
          to?: ContentState
          expectedVersion?: number
          expectedRevision?: number
        }

        if (!body.to || !contentStates.includes(body.to)) {
          throw new APIError('A valid target state is required', 400)
        }
        if (!Number.isInteger(body.expectedVersion) || body.expectedVersion < 1) {
          throw new APIError('expectedVersion is required for optimistic concurrency', 400)
        }
        if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 1) {
          throw new APIError('expectedRevision is required for optimistic concurrency', 400)
        }

        const current = await req.payload.findByID({
          collection: 'content',
          id,
          depth: 0,
          overrideAccess: true,
        })

        const currentState = current.state as ContentState
        const transition = resolveContentTransition(currentState, body.to)
        assertContentTransitionActor({
          transition,
          user: req.user as { id: string | number; role?: string },
          authorId: typeof current.author === 'object' ? current.author.id : current.author,
        })

        if (Number(current.version) !== body.expectedVersion || Number(current.revision) !== body.expectedRevision) {
          throw new APIError('Content version conflict; reload and retry', 409)
        }

        const now = new Date().toISOString()
        const patch = buildContentStatePatch(body.to, now)
        const nextVersion = Number(current.version) + 1
        const nextRevision = Number(current.revision) + 1

        const updated = await req.payload.update({
          collection: 'content',
          id,
          data: {
            ...patch,
            version: nextVersion,
            revision: nextRevision,
          },
          context: { allowContentStateTransition: true },
          overrideAccess: true,
        })

        return Response.json({
          data: updated,
          transition: {
            from: transition.from,
            to: transition.to,
            permission: transition.permission,
            event: transition.event,
          },
          optimisticConcurrency: {
            previousVersion: body.expectedVersion,
            version: nextVersion,
            previousRevision: body.expectedRevision,
            revision: nextRevision,
          },
          sideEffects:
            body.to === 'PUBLISHED'
              ? ['feed.index', 'search.index', 'notify.followers', 'cache.invalidate']
              : body.to === 'UNPUBLISHED' || body.to === 'DELETED'
                ? ['feed.remove', 'search.remove', 'cache.invalidate']
                : body.to === 'ARCHIVED'
                  ? ['feed.remove', 'search.remove']
                  : [],
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
            409: { description: 'Invalid transition or optimistic concurrency conflict' },
          },
        },
      },
    },
  ],
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    {
      name: 'contentType',
      type: 'select',
      required: true,
      options: contentTypes.map((value) => ({ label: value, value })),
      index: true,
    },
    {
      name: 'state',
      type: 'select',
      required: true,
      defaultValue: 'DRAFT',
      options: contentStates.map((value) => ({ label: value, value })),
      index: true,
      admin: { description: 'Canonical lifecycle state. Mutations must use the state-transition contract.' },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: { description: 'Server-owned author identity; public APIs must never accept arbitrary author assignment.' },
    },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true },
    { name: 'excerpt', type: 'textarea', maxLength: 1000 },
    {
      name: 'bodyR2Key',
      type: 'text',
      admin: { description: 'Canonical R2 object key for article/content JSON. Keep large content out of D1 metadata rows.' },
    },
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
