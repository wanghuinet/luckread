import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

const originTypes = ['ORIGINAL', 'REPOST', 'AUTHORIZED_REPOST', 'TRANSLATION', 'ADAPTATION', 'DERIVATIVE'] as const
const licenseTypes = ['ALL_RIGHTS_RESERVED', 'CC_BY', 'CC_BY_SA', 'CC_BY_NC', 'PUBLIC_DOMAIN', 'CUSTOM'] as const

export const ContentMetadata: CollectionConfig = {
  slug: 'content-metadata',
  admin: { useAsTitle: 'content', defaultColumns: ['content', 'originType', 'category', 'channel', 'updatedAt'] },
  access: {
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
  },
  hooks: {
    beforeChange: [({ data }) => {
      if (!data.content) throw new APIError('content is required', 400)
      if (!originTypes.includes(data.originType)) throw new APIError('Invalid originType', 400)
      if (!licenseTypes.includes(data.licenseType)) throw new APIError('Invalid licenseType', 400)
      if (data.originType === 'ORIGINAL') {
        data.sourceContent = null
        data.sourceUrl = null
      }
      if (data.sourceUrl && !/^https?:\\/\\//i.test(String(data.sourceUrl))) throw new APIError('sourceUrl must use http or https', 400)
      return data
    }],
  },
  fields: [
    { name: 'content', type: 'relationship', relationTo: 'content', required: true, unique: true, index: true },
    { name: 'category', type: 'relationship', relationTo: 'taxonomies', index: true },
    { name: 'channel', type: 'relationship', relationTo: 'taxonomies', index: true },
    { name: 'tags', type: 'relationship', relationTo: 'taxonomies', hasMany: true, index: true },
    { name: 'topics', type: 'relationship', relationTo: 'taxonomies', hasMany: true, index: true },
    { name: 'series', type: 'relationship', relationTo: 'content-series', index: true },
    { name: 'originType', type: 'select', required: true, defaultValue: 'ORIGINAL', options: originTypes.map((value) => ({ label: value, value })), index: true },
    { name: 'sourceContent', type: 'relationship', relationTo: 'content', index: true },
    { name: 'sourceUrl', type: 'text', maxLength: 2000 },
    { name: 'sourceName', type: 'text', maxLength: 200 },
    { name: 'copyrightOwner', type: 'text', maxLength: 200 },
    { name: 'licenseType', type: 'select', required: true, defaultValue: 'ALL_RIGHTS_RESERVED', options: licenseTypes.map((value) => ({ label: value, value })), index: true },
    { name: 'licenseUrl', type: 'text', maxLength: 2000 },
    { name: 'copyrightConfirmedAt', type: 'date' },
    { name: 'canonicalContent', type: 'relationship', relationTo: 'content', index: true },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true },
  ],
  timestamps: true,
}
