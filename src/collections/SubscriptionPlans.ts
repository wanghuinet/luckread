import type { CollectionConfig } from 'payload'
import { hasPermission } from '../lib/authorization'

export const SubscriptionPlans: CollectionConfig = {
  slug: 'subscription-plans',
  admin: { useAsTitle: 'code' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => hasPermission(req.user, 'subscription.plan.manage'),
    update: ({ req }) => hasPermission(req.user, 'subscription.plan.manage'),
    delete: ({ req }) => hasPermission(req.user, 'subscription.plan.manage'),
  },
  fields: [
    { name: 'code', type: 'text', required: true, unique: true, index: true },
    { name: 'name', type: 'text', required: true },
    {
      name: 'entitlements',
      type: 'relationship',
      relationTo: 'entitlements',
      hasMany: true,
      required: true,
      index: true,
    },
    { name: 'active', type: 'checkbox', required: true, defaultValue: true, index: true },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
