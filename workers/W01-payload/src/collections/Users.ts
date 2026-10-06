import type { CollectionConfig } from 'payload'

import { authorizeAdminUser } from '@/auth/w02-session-client'
import { payloadAdminOnly } from '@/auth/payload-admin-access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    // Use Payload's native authentication/recovery pipeline. Keep recovery
    // policy at the collection boundary instead of introducing a parallel
    // W02 password-recovery subsystem.
    forgotPassword: {},
    removeTokenFromResponses: true,
    // AUTH-004 remains contract/evidence gated; native capability is the implementation baseline.
  },
  hooks: {
    // Payload's native credential store is retained only as the Admin login
    // adapter. Ordinary platform login is handled by Better Auth in W02.
    // Fail closed before returning a native login result unless the canonical
    // W02 role assignment is L7/L8.
    afterLogin: [
      async ({ req, token, user }) => {
        const email = typeof user.email === 'string' ? user.email : undefined
        const authorization = await authorizeAdminUser({
          userId: String(user.id),
          email,
        })
        if (
          authorization.adminAccess !== true ||
          (authorization.layer !== 'L7' && authorization.layer !== 'L8') ||
          (!authorization.roles.includes('admin') && !authorization.roles.includes('super_admin'))
        ) {
          throw new Error('ADMIN_ROLE_REQUIRED')
        }

        if (req.context && typeof token === 'string') {
          ;(req.context as Record<string, unknown>).__luckreadNativeAuthToken = token
        }
      },
    ],
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
