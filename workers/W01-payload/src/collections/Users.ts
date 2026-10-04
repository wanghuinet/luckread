import type { CollectionConfig } from 'payload'

import { getBetterAuthSession } from '@/auth/better-auth'
import { payloadAdminOnly } from '@/auth/payload-admin-access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    disableLocalStrategy: true,
    strategies: [
      {
        name: 'better-auth',
        authenticate: async ({ headers, payload }) => {
          try {
            const session = await getBetterAuthSession(
              new Request('https://luckread-w01.internal/auth', { headers }),
            )
            if (!session?.user?.id) return null

            const accountState = session.user.accountState
            if (accountState && accountState !== 'PENDING_VERIFICATION' && accountState !== 'ACTIVE') {
              return null
            }

            const user = await payload.findByID({
              collection: 'users',
              id: String(session.user.id),
              depth: 0,
              overrideAccess: true,
            })

            if (!user) return null

            return {
              user: {
                collection: 'users',
                ...user,
              },
            }
          } catch {
            return null
          }
        },
      },
    ],
  },
  // Better Auth is now the account/session/password/recovery authority.
  // Payload remains the Users/CMS document authority and never runs a second
  // local password/session implementation.
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
