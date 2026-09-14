import type { CollectionConfig } from 'payload'

export const AccountStateEvents: CollectionConfig = {
  slug: 'account-state-events',
  admin: {
    useAsTitle: 'eventId',
    defaultColumns: ['eventId', 'user', 'fromState', 'toState', 'actorType', 'createdAt'],
  },
  access: {
    read: ({ req }) => Boolean(req.user && ['operator', 'moderator', 'admin', 'super_admin'].includes(req.user.role ?? '')),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'eventId', type: 'text', required: true, unique: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'fromState', type: 'text', required: true, index: true },
    { name: 'toState', type: 'text', required: true, index: true },
    { name: 'actorId', type: 'text', required: true, index: true },
    { name: 'actorType', type: 'select', required: true, options: ['user', 'operator', 'admin', 'system'].map((value) => ({ label: value, value })), index: true },
    { name: 'permission', type: 'text', required: true },
    { name: 'version', type: 'number', required: true, min: 1 },
    { name: 'precondition', type: 'text' },
  ],
  timestamps: true,
}
