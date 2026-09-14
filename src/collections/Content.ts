import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { hasMaterialContentEdit } from '../lib/content-state-machine'
import { transitionContentState } from '../lib/content-transition-service'

const contentTypes = ['article', 'post', 'video_metadata', 'gallery', 'live_metadata', 'series'] as const
const contentStates = ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'] as const

export const Content: CollectionConfig = {
  slug: 'content',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'contentType', 'state', 'author', 'ip', 'updatedAt'] },
  access: {
    read: ({ req }) => (req.user ? true : { state: { equals: 'PUBLISHED' } }),
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
    afterChange: [
      async ({ doc, operation, req }) => {
        const actorId = req.user ? String(req.user.id) : String(doc.author)
        await req.payload.create({
          collection: 'content-revisions',
          data: {
            revisionId: randomUUID(),
            content: String(doc.id),
            revision: Number(doc.revision),
            version: Number(doc.version),
            author: String(doc.author),
            state: String(doc.state),
            snapshot: {
              title: doc.title,
              slug: doc.slug,
              contentType: doc.contentType,
              locale: doc.locale,
              excerpt: doc.excerpt,
              bodyR2Key: doc.bodyR2Key,
              coverMedia: doc.coverMedia,
              state: doc.state,
            },
            changeReason: operation,
            createdBy: actorId,
          },
          overrideAccess: true,
          req,
        })
      },
    ],
  },
  endpoints: [
    {
      path: '/:id/state',
      method: 'post',
      handler: async (req) => {
        const body = (await req.json()) as { to?: (typeof contentStates)[number]; expectedVersion?: number; expectedRevision?: number }
        if (!body.to || !contentStates.includes(body.to)) throw new APIError('A valid target state is required', 400)
        return transitionContentState(req, body.to, body)
      },
      custom: { openapi: { summary: 'Transition content lifecycle state' } },
    },
    {
      path: '/:id/submit-review',
      method: 'post',
      handler: async (req) => transitionContentState(req, 'PENDING_REVIEW'),
      custom: { openapi: { summary: 'Submit content for review' } },
    },
    {
      path: '/:id/approve',
      method: 'post',
      handler: async (req) => transitionContentState(req, 'APPROVED'),
      custom: { openapi: { summary: 'Approve content' } },
    },
    {
      path: '/:id/reject',
      method: 'post',
      handler: async (req) => transitionContentState(req, 'REJECTED'),
      custom: { openapi: { summary: 'Reject content' } },
    },
    {
      path: '/:id/publish',
      method: 'post',
      handler: async (req) => transitionContentState(req, 'PUBLISHED'),
      custom: { openapi: { summary: 'Publish content' } },
    },
    {
      path: '/:id/restore',
      method: 'post',
      handler: async (req) => transitionContentState(req, 'RESTORED'),
      custom: { openapi: { summary: 'Restore deleted content within the restore window' } },
    },
  ],
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'contentType', type: 'select', required: true, options: contentTypes.map((value) => ({ label: value, value })), index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'DRAFT', options: contentStates.map((value) => ({ label: value, value })), index: true },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'ip', type: 'relationship', relationTo: 'ips', index: true },
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
