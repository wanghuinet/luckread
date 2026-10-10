import { applyAccountStateTransition } from '../account/account-state-transition.js'
import { ensureBaseUserRole } from '../authz/role-assignment.js'
import { betterAuth } from 'better-auth'
import { bearer } from 'better-auth/plugins'

export interface BetterAuthEnv {
  D1_01: D1Database
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  CLOUDFLARE_ENV?: string
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

type ResendEmailPurpose = 'email_verification' | 'password_reset'

type ResendEmailInput = {
  purpose: ResendEmailPurpose
  to: string
  subject: string
  text: string
  html: string
}

const safeProviderField = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) return undefined
  return value
}

/**
 * Shared Resend delivery path for Better Auth verification and password reset.
 * Logs only safe provider diagnostics; never log recipient addresses, message
 * content, verification URLs, or credentials. A 2xx response means the provider
 * accepted the message, not that it reached the recipient's inbox.
 */
async function sendResendEmail(env: BetterAuthEnv, input: ResendEmailInput): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.AUTH_EMAIL_FROM?.trim()
  const deliveryAttemptId = crypto.randomUUID()
  const diagnosticPrefix = input.purpose === 'email_verification'
    ? 'AUTH_EMAIL_DELIVERY'
    : 'AUTH_PASSWORD_RESET_DELIVERY'
  const eventPrefix = 'auth.' + input.purpose

  if (!apiKey || !from) {
    console.error(JSON.stringify({
      event: eventPrefix + '.delivery_unconfigured',
      diagnosticCode: diagnosticPrefix + '_UNCONFIGURED',
      deliveryAttemptId,
    }))
    throw new Error(diagnosticPrefix + '_UNCONFIGURED')
  }

  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    console.error(JSON.stringify({
      event: eventPrefix + '.delivery_failure',
      diagnosticCode: diagnosticPrefix + (timedOut ? '_TIMEOUT' : '_NETWORK_FAILURE'),
      deliveryAttemptId,
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    throw new Error(diagnosticPrefix + (timedOut ? '_TIMEOUT' : '_NETWORK_FAILURE'))
  }

  let providerPayload: unknown = null
  try {
    providerPayload = await response.json()
  } catch {
    // Some upstream/proxy failures return non-JSON bodies; status remains useful.
  }
  const providerRecord = providerPayload && typeof providerPayload === 'object'
    ? providerPayload as Record<string, unknown>
    : {}

  if (!response.ok) {
    console.error(JSON.stringify({
      event: eventPrefix + '.delivery_failure',
      diagnosticCode: diagnosticPrefix + '_REJECTED',
      deliveryAttemptId,
      status: response.status,
      providerErrorName: safeProviderField(providerRecord.name) ?? null,
      providerErrorCode: safeProviderField(providerRecord.statusCode)
        ?? safeProviderField(providerRecord.code)
        ?? null,
    }))
    throw new Error(diagnosticPrefix + '_REJECTED')
  }

  console.info(JSON.stringify({
    event: eventPrefix + '.delivery_accepted',
    diagnosticCode: diagnosticPrefix + '_ACCEPTED',
    deliveryAttemptId,
    status: response.status,
    providerMessageId: safeProviderField(providerRecord.id) ?? null,
  }))
}

async function sendVerificationEmail(
  env: BetterAuthEnv,
  input: { user: { email: string }; url: string },
): Promise<void> {
  const safeUrl = escapeHtml(input.url)
  await sendResendEmail(env, {
    purpose: 'email_verification',
    to: input.user.email,
    subject: 'Verify your LuckRead email',
    text: 'Verify your LuckRead email by opening this link: ' + input.url,
    html: '<p>Welcome to LuckRead.</p><p>Verify your email address to activate your account:</p><p><a href="' + safeUrl + '">Verify email address</a></p>',
  })
}

async function sendPasswordResetEmail(
  env: BetterAuthEnv,
  input: { user: { email: string }; url: string },
): Promise<void> {
  const safeUrl = escapeHtml(input.url)
  await sendResendEmail(env, {
    purpose: 'password_reset',
    to: input.user.email,
    subject: 'Reset your LuckRead password',
    text: 'Reset your LuckRead password by opening this link: ' + input.url,
    html: '<p>We received a request to reset your LuckRead password.</p><p>If you requested this, use the link below to choose a new password:</p><p><a href="' + safeUrl + '">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>',
  })
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

const buildLuckReadAuth = (env: BetterAuthEnv) => {
  // Keep local origins available only to the local evidence/runtime profile.
  // Production must never inherit localhost trust from a shared config.
  const trustedOrigins = [
    'https://luckread-w02.internal',
    'https://luckread.com',
    'https://www.luckread.com',
    'https://mp.luckread.com',
    'https://sso.luckread.com',
    ...(env.CLOUDFLARE_ENV?.trim().toLowerCase() === 'development'
      ? ['http://127.0.0.1:8787', 'http://localhost:8787']
      : []),
  ]

  return betterAuth({
    // W02 is the platform identity authority. Better Auth uses native D1
    // persistence here; Payload is not an authentication/database adapter.
    database: env.D1_01,
    baseURL: 'https://luckread.com',
    basePath: '/api/auth',
    trustedOrigins,
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
    plugins: [bearer()],
    advanced: {
      database: {
        // Fail closed and log actionable schema drift before it degrades
        // a registration/login request into an opaque database error.
        validateSchema: true,
        generateId: () => crypto.randomUUID(),
      },
    },
  })
}

const authInstances = new WeakMap<D1Database, ReturnType<typeof buildLuckReadAuth>>()

// W02 routes share one initialized Better Auth instance per D1 binding/isolate.
// This preserves Better Auth's cached schema validation and avoids rebuilding
// its router and database adapter for every authentication request.
export const createLuckReadAuth = (env: BetterAuthEnv) => {
  const cached = authInstances.get(env.D1_01)
  if (cached) return cached

  const auth = buildLuckReadAuth(env)
  authInstances.set(env.D1_01, auth)
  return auth
}
