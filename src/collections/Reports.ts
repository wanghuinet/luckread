import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { transitionReport } from '../lib/moderation-state-service'

export const Reports: CollectionConfig = {
  slug: 'reports',
  admin: { useAsTitle: 'reportId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => ['moderator', 'admin', 'super_admin'].includes(String((req.user as { role?: string } | null)?.role ?? '')),
    delete: () => false,
  },
  endpoints: [
    { path: '/:id/under-review', method: 'post', handler: async (req) => transitionReport(req, 'UNDER_REVIEW') },
    { path: '/:id/resolve', method: 'post', handler: async (req) => transitionReport(req, 'RESOLVED') },
    { path: '/:id/dismiss', method: 'post', handler: async (req) => transitionReport(req, 'DISMISSED') },
  ],
  hooks: {
    beforeChange: [({ data, req, originalDoc }) => {
      if (originalDoc && data.status !== undefined && data.status !== originalDoc.status) {
        throw new APIError('Report status must be changed through the moderation API', 400)
      }
      if (!originalDoc && req.user && data.reporter !== undefined && String(data.reporter) !== String(req.user.id)) {
        throw new APIError('Reporter must be the authenticated user', 403)
      }
      return data
    }],
  },
  fields: [
    { name: 'reportId', type: 'text', required: true, unique: true, index: true },
    { name: 'reporter', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', index: true },
    { name: 'reportedUser', type: 'relationship', relationTo: 'users', index: true },
    { name: 'reason', type: 'select', required: true, options: [
      { label: 'Spam', value: 'SPAM' }, { label: 'Copyright', value: 'COPYRIGHT' }, { label: 'Harassment', value: 'HARASSMENT' },
      { label: 'Illegal', value: 'ILLEGAL' }, { label: 'Misleading', value: 'MISLEADING' }, { label: 'Other', value: 'OTHER' },
    ], index: true },
    { name: 'details', type: 'textarea' },
    { name: 'status', type: 'select', required: true, defaultValue: 'OPEN', options: [
      { label: 'Open', value: 'OPEN' }, { label: 'UNDER_REVIEW', value: 'UNDER_REVIEW' }, { label: 'RESOLVED', value: 'RESOLVED' }, { label: 'DISMISSED', value: 'DISMISSED' },
    ], index: true },
    { name: 'resolution', type: 'textarea' },
  ],
  timestamps: true,
}
