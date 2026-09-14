import type { CollectionConfig } from 'payload'

export const ModerationEvents: CollectionConfig = {
  slug: 'moderation-events',
  admin: { useAsTitle: 'eventId' },
  access: {
    read: ({ req }) => ['moderator', 'admin', 'super_admin'].includes(String((req.user as { role?: string } | null)?.role ?? '')),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'eventId', type: 'text', required: true, unique: true, index: true },
    { name: 'resourceType', type: 'select', required: true, options: [{ label: 'Report', value: 'report' }, { label: 'Appeal', value: 'appeal' }], index: true },
    { name: 'resourceId', type: 'text', required: true, index: true },
    { name: 'action', type: 'text', required: true, index: true },
    { name: 'fromState', type: 'text', required: true },
    { name: 'toState', type: 'text', required: true },
    { name: 'actorId', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
