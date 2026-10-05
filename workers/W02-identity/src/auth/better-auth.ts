import { betterAuth } from 'better-auth/minimal'

import {
  hashLuckReadPassword,
  luckReadBetterAuthAdapter,
  verifyLuckReadPassword,
} from './better-auth-adapter.js'

export interface BetterAuthEnv {
  D1_01: D1Database
}

export const createLuckReadAuth = (env: BetterAuthEnv) =>
  betterAuth({
    database: luckReadBetterAuthAdapter(env.D1_01),
    basePath: '/api/auth',
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      password: {
        hash: hashLuckReadPassword,
        verify: verifyLuckReadPassword,
      },
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async () => {
        throw new Error('PASSWORD_RESET_DELIVERY_UNCONFIGURED')
      },
    },
    user: {
      modelName: 'users',
      fields: {
        name: 'display_name',
        image: 'avatar',
        email: 'email',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        username: {
          type: 'string',
          required: false,
          input: true,
          returned: true,
        },
        bio: {
          type: 'string',
          required: false,
          input: true,
          returned: true,
        },
        locale: {
          type: 'string',
          required: false,
          input: true,
          returned: true,
        },
        timezone: {
          type: 'string',
          required: false,
          input: true,
          returned: true,
        },
        accountState: {
          type: 'string',
          required: false,
          input: false,
          returned: true,
          fieldName: 'account_state',
        },
        accountStateVersion: {
          type: 'number',
          required: false,
          input: false,
          returned: true,
          fieldName: 'account_state_version',
        },
      },
    },
    session: {
      modelName: 'users_sessions',
      fields: {
        userId: '_parent_id',
        token: 'id',
        createdAt: 'created_at',
        expiresAt: 'expires_at',
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      database: {
        validateSchema: false,
        generateId: (options) => {
          if (options.model === 'user' || options.model === 'users') return false
          return crypto.randomUUID()
        },
      },
    },
  })
