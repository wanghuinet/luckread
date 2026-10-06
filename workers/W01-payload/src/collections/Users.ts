import type { CollectionConfig } from 'payload'

import { payloadBetterAuthBridgeStrategy } from '@/auth/payload-better-auth-bridge'
import { payloadAdminOnly } from '@/auth/payload-admin-access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    // Better Auth is the platform account/recovery authority in W02.
    // Payload remains a CMS/Admin integration boundary and accepts only the
    // signed Better Auth bridge for application-owned authenticated access.
    disableLocalStrategy: true,
    removeTokenFromResponses: true,
    strategies: [payloadBetterAuthBridgeStrategy],
  },
  // Better Auth is the sole platform account-creation authority in W02.
  // Payload keeps this collection only as a CMS/Admin integration boundary;
  // it must never create a second account authority through /api/users.
  access: {
    create: () => false,
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
