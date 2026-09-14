import type { CollectionConfig } from 'payload'

export const ContentEventEffects: CollectionConfig = {
  slug: 'content-event-effects',
  admin: {
    useAsTitle: 'effectId',
    defaultColumns: ['effectId', 'eventId', 'effect', 'status', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user && ['admin', 'super_admin', 'moderator'].includes(req.user.role ?? '')),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'effectId', type: 'text', required: true, unique: true, index: true },
    { name: 'eventId', type: 'text', required: true, index: true },
    { name: 'contentEvent', type: 'relationship', relationTo: 'content-events', required: true, index: true },
    { name: 'effect', type: 'text', required: true, index: true },
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
    { name: 'nextAttemptAt', type: 'date', index: true },
    { name: 'processingStartedAt', type: 'date', index: true },
    { name: 'processorId', type: 'text', index: true },
    { name: 'processedAt', type: 'date' },
    { name: 'lastError', type: 'textarea' },
  ],
  timestamps: true,
}
