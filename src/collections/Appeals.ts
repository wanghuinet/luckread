import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { transitionAppeal } from '../lib/moderation-state-service'

export const Appeals: CollectionConfig = {
  slug: 'appeals',
  admin: { useAsTitle: 'appealId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => ['moderator', 'admin', 'super_admin'].includes(String((req.user as { role?: string } | null)?.role ?? '')),
    delete: () => false,
  },
  endpoints: [
    { path: '/:id/under-review', method: 'post', handler: async (req) => transitionAppeal(req, 'UNDER_REVIEW') },
    { path: '/:id/uphold', method: 'post', handler: async (req) => transitionAppeal(req, 'UPHELD') },
    { path: '/:id/overturn', method: 'post', handler: async (req) => transitionAppeal(req, 'OVERTURNED') },
    { path: '/:id/close', method: 'post', handler: async (req) => transitionAppeal(req, 'CLOSED') },
  ],
  hooks: {
    beforeChange: [({ data, req, originalDoc }) => {
      if (originalDoc && data.status !== undefined && data.status !== originalDoc.status) {
        throw new APIError('Appeal status must be changed through the moderation API', 400)
      }
      if (originalDoc && data.decidedBy !== undefined && String(data.decidedBy) !== String(originalDoc.decidedBy)) {
        throw new APIError('Appeal decision actor is immutable outside the moderation API', 400)
      }
      if (!originalDoc && req.user && data.appellant !== undefined && String(data.appellant) !== String(req.user.id)) {
        throw new APIError('Appellant must be the authenticated user', 403)
      }
      return data
    }],
  },
  fields: [
    { name: 'appealId', type: 'text', required: true, unique: true, index: true },
    { name: 'appellant', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', index: true },
    { name: 'report', type: 'relationship', relationTo: 'reports', index: true },
    { name: 'reason', type: 'textarea', required: true },
    { name: 'evidence', type: 'json' },
    { name: 'status', type: 'select', required: true, defaultValue: 'OPEN', options: [
      { label: 'Open', value: 'OPEN' }, { label: 'UNDER_REVIEW', value: 'UNDER_REVIEW' }, { label: 'UPHELD', value: 'UPHELD' }, { label: 'OVERTURNED', value: 'OVERTURNED' }, { label: 'CLOSED', value: 'CLOSED' },
    ], index: true },
    { name: 'decision', type: 'textarea' },
    { name: 'decidedBy', type: 'relationship', relationTo: 'users', index: true },
  ],
  timestamps: true,
}
