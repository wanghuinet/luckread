import type { CollectionConfig } from 'payload'

export const ContentShares: CollectionConfig = {
  slug: 'content-shares',
  admin: { useAsTitle: 'shareId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'shareId', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'user', type: 'relationship', relationTo: 'users', index: true },
    { name: 'channel', type: 'text', required: true, index: true },
    { name: 'target', type: 'text' },
    { name: 'requestId', type: 'text', required: true, unique: true, index: true },
    { name: 'metadata', type: 'json' },
  ],
  timestamps: true,
}
