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
    removeTokenFromResponses: true,
    strategies: [payloadBetterAuthBridgeStrategy],
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
