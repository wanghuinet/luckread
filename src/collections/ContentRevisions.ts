import type { CollectionConfig } from 'payload'

export const ContentRevisions: CollectionConfig = {
  slug: 'content-revisions',
  admin: { useAsTitle: 'revisionId' },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'revisionId', type: 'text', required: true, unique: true, index: true },
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, index: true },
    { name: 'revision', type: 'number', required: true, min: 1, index: true },
    { name: 'version', type: 'number', required: true, min: 1 },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'state', type: 'text', required: true, index: true },
    { name: 'snapshot', type: 'json', required: true },
    { name: 'changeReason', type: 'text' },
    { name: 'createdBy', type: 'relationship', relationTo: 'users', required: true },
  ],
  timestamps: true,
}
