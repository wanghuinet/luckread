import type { CollectionConfig } from 'payload'

const contentTypes = ['article', 'post', 'video_metadata', 'gallery', 'live_metadata', 'series'] as const
const contentStates = [
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
  'DELETED',
  'RESTORED',
] as const

export const Content: CollectionConfig = {
  slug: 'content',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'contentType', 'state', 'author', 'updatedAt'],
  },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      return { state: { equals: 'PUBLISHED' } }
    },
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 200,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'contentType',
      type: 'select',
      required: true,
      options: contentTypes.map((value) => ({ label: value, value })),
      index: true,
    },
    {
      name: 'state',
      type: 'select',
      required: true,
      defaultValue: 'DRAFT',
      options: contentStates.map((value) => ({ label: value, value })),
      index: true,
      admin: { description: 'Canonical lifecycle state. Mutations must use the state-transition contract.' },
    },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: { description: 'Server-owned author identity; public APIs must never accept arbitrary author assignment.' },
    },
    {
      name: 'locale',
      type: 'text',
      required: true,
      defaultValue: 'en-US',
      index: true,
    },
    {
      name: 'excerpt',
      type: 'textarea',
      maxLength: 1000,
    },
    {
      name: 'bodyR2Key',
      type: 'text',
      admin: {
        description: 'Canonical R2 object key for article/content JSON. Keep large content out of D1 metadata rows.',
      },
    },
    {
      name: 'coverMedia',
      type: 'relationship',
      relationTo: 'media',
    },
    {
      name: 'scheduledAt',
      type: 'date',
      index: true,
    },
    {
      name: 'publishedAt',
      type: 'date',
      index: true,
    },
    {
      name: 'archivedAt',
      type: 'date',
    },
    {
      name: 'deletedAt',
      type: 'date',
    },
    {
      name: 'version',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
    },
    {
      name: 'revision',
      type: 'number',
      required: true,
      defaultValue: 1,
      min: 1,
    },
  ],
  timestamps: true,
}
