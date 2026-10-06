import type { CollectionConfig } from 'payload'

import { payloadAdminOnly } from '@/auth/payload-admin-access'
import { betterAuthPayloadStrategy } from '@/auth/better-auth-payload-strategy'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    disableLocalStrategy: true,
    strategies: [betterAuthPayloadStrategy],
    forgotPassword: {},
    removeTokenFromResponses: true,
    },

  // AUTH-001 contract: account registration is anonymous/public. Keep the
  // public boundary limited to creation; read/update/delete remain protected
  // by Payload's default authenticated access control until explicit rules
  // are defined at the canonical API boundary.
  access: {
    create: () => true,
    admin: payloadAdminOnly,
  },
  fields: [
    {
      name: 'username',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
    {
      name: 'displayName',
      type: 'text',
    },
    {
      name: 'bio',
      type: 'textarea',
    },
    {
      name: 'avatar',
      type: 'text',
    },
    {
      name: 'locale',
      type: 'text',
      defaultValue: 'en-US',
    },
    {
      name: 'timezone',
      type: 'text',
      defaultValue: 'UTC',
    },
  ],
  versions: false,
}
