import type { CollectionConfig } from 'payload'

import { betterAuthPayloadStrategy } from '@/auth/better-auth-payload-strategy'
import { payloadAdminOnly } from '@/auth/payload-admin-access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: {
    // Keep Payload's generated auth fields (notably email) for the W01 profile
    // projection while disabling its credential/session authority. Better Auth
    // in W02 remains the only authentication strategy.
    disableLocalStrategy: { enableFields: true, optionalPassword: true },
    strategies: [betterAuthPayloadStrategy],
  },
  // Account creation is Better Auth/W02-owned. W01 only stores the
  // corresponding profile projection, written by trusted internal flows with
  // overrideAccess.
  access: {
    create: () => false,
    read: payloadAdminOnly,
    update: payloadAdminOnly,
    delete: payloadAdminOnly,
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
