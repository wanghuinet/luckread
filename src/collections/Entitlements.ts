import type { CollectionConfig } from 'payload'

export const Entitlements: CollectionConfig = {
  slug: 'entitlements',
  admin: { useAsTitle: 'code' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'code', type: 'text', required: true, unique: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    { name: 'scope', type: 'text', required: true, defaultValue: 'global', index: true },
    { name: 'active', type: 'checkbox', required: true, defaultValue: true, index: true },
  ],
  timestamps: true,
}
