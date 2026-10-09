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
      sendResetPassword: async () => {
        throw new Error('PASSWORD_RESET_DELIVERY_UNCONFIGURED')
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
