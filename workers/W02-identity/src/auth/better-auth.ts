import { applyAccountStateTransition } from '../account/account-state-transition.js'
import { ensureBaseUserRole } from '../authz/role-assignment.js'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

export interface BetterAuthEnv {
  D1_01: D1Database
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}

type AccountStateRow = {
  accountState: string
  accountStateVersion: number
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

async function sendVerificationEmail(
  env: BetterAuthEnv,
  input: { user: { email: string }; url: string },
): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.AUTH_EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    console.error(JSON.stringify({
      event: 'auth.email_verification.delivery_unconfigured',
      diagnosticCode: 'AUTH_EMAIL_DELIVERY_UNCONFIGURED',
    }))
    throw new Error('EMAIL_DELIVERY_UNCONFIGURED')
  }

  const safeUrl = escapeHtml(input.url)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.user.email],
      subject: 'Verify your LuckRead email',
      text: 'Verify your LuckRead email by opening this link: ' + input.url,
      html: '<p>Welcome to LuckRead.</p><p>Verify your email address to activate your account:</p><p><a href="' + safeUrl + '">Verify email address</a></p>',
    }),
  })

  if (!response.ok) {
    console.error(JSON.stringify({
      event: 'auth.email_verification.delivery_failure',
      diagnosticCode: 'AUTH_EMAIL_DELIVERY_FAILED',
      status: response.status,
    }))
    throw new Error('EMAIL_DELIVERY_FAILED')
  }
}


async function sendPasswordResetEmail(
  env: BetterAuthEnv,
  input: { user: { email: string }; url: string },
): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.AUTH_EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    console.error(JSON.stringify({
      event: 'auth.password_reset.delivery_unconfigured',
      diagnosticCode: 'AUTH_PASSWORD_RESET_DELIVERY_UNCONFIGURED',
    }))
    throw new Error('PASSWORD_RESET_DELIVERY_UNCONFIGURED')
  }

  const safeUrl = escapeHtml(input.url)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [input.user.email],
      subject: 'Reset your LuckRead password',
      text: 'Reset your LuckRead password by opening this link: ' + input.url,
      html: '<p>We received a request to reset your LuckRead password.</p><p>If you requested this, use the link below to choose a new password:</p><p><a href="' + safeUrl + '">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>',
    }),
  })

  if (!response.ok) {
    console.error(JSON.stringify({
      event: 'auth.password_reset.delivery_failure',
      diagnosticCode: 'AUTH_PASSWORD_RESET_DELIVERY_FAILED',
      status: response.status,
    }))
    throw new Error('PASSWORD_RESET_DELIVERY_FAILED')
  }
}

async function activateVerifiedAccount(db: D1Database, userId: string): Promise<void> {
  const readCurrent = () => db
    .prepare(
      'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM "user" WHERE id = ? LIMIT 1',
    )
    .bind(userId)
    .first<AccountStateRow>()

  const current = await readCurrent()
  if (!current || current.accountState === 'ACTIVE') return
  if (current.accountState !== 'PENDING_VERIFICATION') return
  if (!Number.isSafeInteger(current.accountStateVersion) || current.accountStateVersion < 1) {
    throw new Error('ACCOUNT_STATE_VERSION_INVALID')
  }

  try {
    await applyAccountStateTransition(db, {
      userId,
      to: 'ACTIVE',
      reason: 'email verification completed',
      expectedVersion: current.accountStateVersion,
      actor: { id: userId, type: 'user' },
      permission: null,
      preconditionSatisfied: true,
    })
  } catch (error) {
    // Verification callbacks can race. Treat an already-committed activation
    // as success, while preserving failures that left the account pending.
    const latest = await readCurrent()
    if (latest?.accountState === 'ACTIVE') return
    throw error
  }
}

const sanitizeAuthDiagnostic = (value: string): string => value
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
  .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
  .replace(/(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .slice(0, 240)

export const createLuckReadAuth = (env: BetterAuthEnv) =>
  betterAuth({
    // W02 is the platform identity authority. Better Auth uses native D1
    // persistence here; Payload is not an authentication/database adapter.
    database: env.D1_01,
    baseURL: 'https://luckread.com',
    basePath: '/api/auth',
    trustedOrigins: [
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
        await sendPasswordResetEmail(env, { user, url })
      },
    },
    emailVerification: {
      // W01 commits registration and its idempotency envelope before invoking
      // the public resend endpoint; this avoids a mail failure orphaning an
      // identity before W01 has created its profile projection.
      sendOnSignUp: false,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(env, { user, url })
      },
      afterEmailVerification: async (user) => {
        await activateVerifiedAccount(env.D1_01, String(user.id))
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
      // The checked-in D1 schema deliberately uses snake_case columns.
      // Map Better Auth's camelCase core fields to those exact column names.
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
    session: {
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        userId: 'user_id',
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      modelName: 'session',
    },
    logger: {
      level: 'error',
      log: (level, message, ...args) => {
        const errors = args
          .filter((value): value is Error => value instanceof Error)
          .map((error) => ({
            name: error.name,
            message: sanitizeAuthDiagnostic(error.message),
          }))
        console.error(JSON.stringify({
          event: 'auth.better_auth.internal_error',
          level,
          message: sanitizeAuthDiagnostic(String(message)),
          errors,
        }))
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
