import { ensureBaseUserRole } from '../authz/role-assignment.js'
import { reconcileOrphanedSessionExtensions } from '../session/session-runtime.js'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

export interface PasswordResetEmailBinding {
  send(message: {
    to: string
    from: string
    subject: string
    html: string
    text: string
  }): Promise<unknown>
}

export interface BetterAuthEnv {
  D1_01: D1Database
  BETTER_AUTH_SECRET: string
  EMAIL?: PasswordResetEmailBinding
  PASSWORD_RESET_FROM_EMAIL?: string
}

export const createLuckReadAuth = (env: BetterAuthEnv) =>
  betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    // W02 is the platform identity authority. Better Auth uses native D1
    // persistence here; Payload is not an authentication/database adapter.
    database: env.D1_01,
    basePath: '/api/auth',
    trustedOrigins: [
      'https://luckread.com',
      'https://www.luckread.com',
      'https://mp.luckread.com',
    ],
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: false,
      autoSignIn: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!env.EMAIL) {
          throw new Error('PASSWORD_RESET_DELIVERY_UNCONFIGURED')
        }

        const from = env.PASSWORD_RESET_FROM_EMAIL?.trim() || 'noreply@luckread.com'
        const escapedUrl = url
          .replaceAll('&', '&amp;')
          .replaceAll('"', '&quot;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')

        void env.EMAIL.send({
          to: user.email,
          from,
          subject: 'LuckRead 密码重置',
          text: ['请使用以下链接重置你的 LuckRead 密码：', url, '', '如果这不是你的操作，请忽略此邮件。'].join('\n'),
          html: '<p>请使用以下链接重置你的 LuckRead 密码：</p><p><a href="' + escapedUrl + '">重置密码</a></p><p>如果这不是你的操作，请忽略此邮件。</p>',
        }).catch((error) => {
          console.error(JSON.stringify({
            event: 'auth.password_reset.email_delivery_failure',
            diagnosticCode: 'AUTH004_PASSWORD_RESET_EMAIL_DELIVERY_FAILURE',
            errorName: error instanceof Error ? error.name : typeof error,
          }))
        })
      },
      onPasswordReset: async ({ user }) => {
        try {
          await reconcileOrphanedSessionExtensions(
            env.D1_01,
            String(user.id),
            '',
            new Date().toISOString(),
          )
        } catch (error) {
          console.error(JSON.stringify({
            event: 'auth.password_reset.session_extension_reconciliation_failure',
            diagnosticCode: 'AUTH004_PASSWORD_RESET_SESSION_EXTENSION_RECONCILIATION_FAILURE',
            errorName: error instanceof Error ? error.name : typeof error,
          }))
        }
      },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensureBaseUserRole(env.D1_01, String(user.id), new Date().toISOString())
          },
        },
      },
    },
    user: {
      fields: {
        emailVerified: 'email_verified',
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
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      modelName: 'session',
    },
    account: {
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    plugins: [bearer()],
    advanced: {
      database: {
        validateSchema: false,
        generateId: () => crypto.randomUUID(),
      },
    },
  })
