import type { CollectionConfig } from 'payload'

import { betterAuthPayloadStrategy } from '@/auth/better-auth-payload-strategy'
import { payloadAdminOnly } from '@/auth/payload-admin-access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: {
    disableLocalStrategy: true,
    strategies: [betterAuthPayloadStrategy],
  },
  access: {
    create: () => true,
    admin: payloadAdminOnly,
  },
  fields: [
    { name: 'identityId', type: 'text', required: false, unique: true, index: true, admin: { readOnly: true } },
    { name: 'username', type: 'text', required: true, unique: true, index: true },
    { name: 'displayName', type: 'text' },
    { name: 'bio', type: 'textarea' },
    { name: 'avatar', type: 'text' },
    { name: 'locale', type: 'text', defaultValue: 'en-US' },
    { name: 'timezone', type: 'text', defaultValue: 'UTC' },
  ],
  versions: false,
}
