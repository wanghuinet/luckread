import type { CollectionConfig } from 'payload'

export const Reports: CollectionConfig = {
  slug: 'reports',
  admin: { useAsTitle: 'reportId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: () => false,
  },
  fields: [
    { name: 'reportId', type: 'text', required: true, unique: true, index: true },
    { name: 'reporter', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', index: true },
    { name: 'reportedUser', type: 'relationship', relationTo: 'users', index: true },
    { name: 'reason', type: 'select', required: true, options: [
      { label: 'Spam', value: 'SPAM' },
      { label: 'Copyright', value: 'COPYRIGHT' },
      { label: 'Harassment', value: 'HARASSMENT' },
      { label: 'Illegal', value: 'ILLEGAL' },
      { label: 'Misleading', value: 'MISLEADING' },
      { label: 'Other', value: 'OTHER' },
    ], index: true },
    { name: 'details', type: 'textarea' },
    { name: 'status', type: 'select', required: true, defaultValue: 'OPEN', options: [
      { label: 'Open', value: 'OPEN' },
      { label: 'UNDER_REVIEW', value: 'UNDER_REVIEW' },
      { label: 'RESOLVED', value: 'RESOLVED' },
      { label: 'DISMISSED', value: 'DISMISSED' },
    ], index: true },
    { name: 'resolution', type: 'textarea' },
  ],
  timestamps: true,
}
