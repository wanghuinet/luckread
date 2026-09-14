import type { CollectionConfig } from 'payload'

export const ContentEvents: CollectionConfig = {
  slug: 'content-events',
  admin: {
    useAsTitle: 'eventId',
    defaultColumns: ['eventId', 'content', 'event', 'status', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user && ['admin', 'super_admin', 'moderator'].includes(req.user.role ?? '')),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'eventId', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'event', type: 'text', required: true, index: true },
    { name: 'fromState', type: 'text' },
    { name: 'toState', type: 'text', required: true, index: true },
    { name: 'actorId', type: 'text', required: true, index: true },
    { name: 'permission', type: 'text', required: true },
    { name: 'version', type: 'number', required: true, min: 1 },
    { name: 'revision', type: 'number', required: true, min: 1 },
    {
      name: 'sideEffects',
      type: 'json',
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'PENDING',
      options: [
        { label: 'Pending', value: 'PENDING' },
        { label: 'Processing', value: 'PROCESSING' },
        { label: 'Processed', value: 'PROCESSED' },
        { label: 'Failed', value: 'FAILED' },
      ],
      index: true,
    },
    { name: 'attempts', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'processedAt', type: 'date' },
    { name: 'lastError', type: 'textarea' },
  ],
  timestamps: true,
}
