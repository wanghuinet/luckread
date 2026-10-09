import { activateEmailVerifiedAccount } from '../account/account-state-transition.js'
import { ensureBaseUserRole } from '../authz/role-assignment.js'
import { dispatchAuthEmail, escapeAuthEmailHtml, type AuthEmailEnvironment } from './email-delivery.js'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

export interface BetterAuthEnv extends AuthEmailEnvironment {
  D1_01: D1Database
  AUTH_PUBLIC_BASE_URL?: string
}

export const createLuckReadAuth = (env: BetterAuthEnv) => {
  const publicBaseURL = (env.AUTH_PUBLIC_BASE_URL?.trim() || 'https://luckread.com').replace(/\\/+$/, '')
  return betterAuth({
    baseURL: publicBaseURL,
    // W02 is the platform identity authority. Better Auth uses native D1
    // persistence here; Payload is not an authentication/database adapter.
    database: env.D1_01,
    basePath: '/api/auth',
    trustedOrigins: [
      publicBaseURL,
      'https://luckread-w02.internal',
      'https://luckread.com',
      'https://www.luckread.com',
      'https://mp.luckread.com',
      'https://sso.luckread.com',
      'http://127.0.0.1:8787',
      'http://localhost:8787',
    ],
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 15,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const safeURL = escapeAuthEmailHtml(url)
        await dispatchAuthEmail(env, {
          to: user.email,
          subject: 'Reset your LuckRead password',
          text: 'Use this link to reset your LuckRead password: ' + url,
          html: '<p>Use the link below to reset your LuckRead password.</p><p><a href="' + safeURL + '">Reset password</a></p>',
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        const safeURL = escapeAuthEmailHtml(url)
        await dispatchAuthEmail(env, {
          to: user.email,
          subject: 'Verify your LuckRead email',
          text: 'Verify your LuckRead email address: ' + url,
          html: '<p>Welcome to LuckRead.</p><p>Confirm your email address to activate your account and enable social interactions.</p><p><a href="' + safeURL + '">Verify email address</a></p><p>This link expires in 60 minutes.</p>',
        })
      },
      afterEmailVerification: async (user) => {
        await activateEmailVerifiedAccount(env.D1_01, String(user.id))
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
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      modelName: 'session',
    },
    plugins: [bearer()],
    advanced: {
      database: {
        validateSchema: false,
        generateId: () => crypto.randomUUID(),
      },
    },
  })
}
