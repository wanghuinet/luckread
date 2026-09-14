import type { CollectionConfig } from 'payload'

export const Appeals: CollectionConfig = {
  slug: 'appeals',
  admin: { useAsTitle: 'appealId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  fields: [
    { name: 'appealId', type: 'text', required: true, unique: true, index: true },
    { name: 'appellant', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', index: true },
    { name: 'report', type: 'relationship', relationTo: 'reports', index: true },
    { name: 'reason', type: 'textarea', required: true },
    { name: 'evidence', type: 'json' },
    { name: 'status', type: 'select', required: true, defaultValue: 'OPEN', options: [
      { label: 'Open', value: 'OPEN' },
      { label: 'UNDER_REVIEW', value: 'UNDER_REVIEW' },
      { label: 'UPHELD', value: 'UPHELD' },
      { label: 'OVERTURNED', value: 'OVERTURNED' },
      { label: 'CLOSED', value: 'CLOSED' },
    ], index: true },
    { name: 'decision', type: 'textarea' },
    { name: 'decidedBy', type: 'relationship', relationTo: 'users', index: true },
  ],
  timestamps: true,
}
