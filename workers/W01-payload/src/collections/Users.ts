import type { AuthStrategy, CollectionConfig } from 'payload'

import { resolveBetterAuthPrincipal } from '@/auth/w02-auth-client'

const betterAuthPayloadStrategy: AuthStrategy = {
  name: 'luckread-better-auth',
  authenticate: async ({ payload, headers }) => {
    try {
      const principal = await resolveBetterAuthPrincipal(
        new Request('https://luckread-w01.internal/auth', {
          headers: new Headers(headers),
        }),
      )

      const byIdentity = await payload.find({
        collection: 'users',
        where: {
          identityUserId: {
            equals: principal.userId,
          },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })

      const identityUser = byIdentity.docs[0]
      if (identityUser) {
        return {
          user: {
            collection: 'users',
            ...(identityUser as Record<string, unknown>),
          },
        }
      }

      const byEmail = await payload.find({
        collection: 'users',
        where: {
          email: {
            equals: principal.email,
          },
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })

      const emailUser = byEmail.docs[0]
      if (!emailUser) return { user: null }

      return {
        user: {
          collection: 'users',
          ...(emailUser as Record<string, unknown>),
        },
      }
    } catch {
      return { user: null }
    }
  },
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  auth: {
    disableLocalStrategy: true,
    strategies: [betterAuthPayloadStrategy],
  },
  access: {
    create: () => true,
    admin: async ({ req }) => {
      try {
        const principal = await resolveBetterAuthPrincipal(
          new Request('https://luckread-w01.internal/admin', {
            headers: new Headers(req.headers),
          }),
        )
        return principal.layer === 'L7' || principal.layer === 'L8'
      } catch {
        return false
      }
    },
  },
  fields: [
    {
      name: 'identityUserId',
      type: 'text',
      unique: true,
      index: true,
    },
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
