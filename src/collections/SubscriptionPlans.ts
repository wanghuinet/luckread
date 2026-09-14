import type { CollectionConfig } from 'payload'

const isAdmin = (req: { user?: { role?: string } | null }) =>
  req.user?.role === 'admin' || req.user?.role === 'super_admin'

export const SubscriptionPlans: CollectionConfig = {
  slug: 'subscription-plans',
  admin: { useAsTitle: 'code' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => isAdmin(req),
    update: ({ req }) => isAdmin(req),
    delete: ({ req }) => isAdmin(req),
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
