import type { CollectionConfig } from 'payload'

const statuses = ['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'] as const

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: { useAsTitle: 'providerReference' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'planCode', type: 'text', required: true, index: true },
    { name: 'provider', type: 'text', required: true, defaultValue: 'internal', index: true },
    { name: 'providerReference', type: 'text', required: true, unique: true, index: true },
    { name: 'status', type: 'select', required: true, defaultValue: 'PENDING', options: statuses.map((value) => ({ label: value, value })), index: true },
    { name: 'startsAt', type: 'date', required: true },
    { name: 'endsAt', type: 'date' },
    { name: 'cancelAtPeriodEnd', type: 'checkbox', defaultValue: false },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
