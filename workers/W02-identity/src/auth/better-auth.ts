import { activateEmailVerifiedAccount } from '../account/account-state-transition.js'
import { ensureBaseUserRole, ensureVerifiedUserRole } from '../authz/role-assignment.js'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { symmetricDecrypt } from 'better-auth/crypto'
import { betterAuth } from 'better-auth'
import { bearer, twoFactor } from 'better-auth/plugins'
import { consumeTotpTimeStep, matchTotpTimeStep } from './totp-replay-guard.js'
import { isActiveMfaSubject } from './mfa-challenge-account-state.js'
import { isUnexpiredMfaChallengeRecord } from './mfa-challenge-verification.js'
import { deriveMfaAuditEventIdForIdempotencyKey } from './mfa-audit-events.js'
import { sendResendEmail } from './resend-email.js'
import {
  appendMfaAuditOperationReceiptEvent,
  assertMfaAuditOperationReceiptOwner,
  createMfaAuditOperationReceipt,
  finalizeMfaAuditOperationReceipt,
  reconcileMfaAuditOperationReceipts,
  type MfaAuditReceiptEvent,
} from './mfa-audit-receipts.js'
import {
  classifyMfaAuditHookOutcome,
  getMfaAuditHookState,
  isMfaAuditFailureOutcome,
  MFA_AUDIT_OBSERVED_PATHS,
  setMfaAuditHookState,
} from './mfa-audit-hooks.js'

export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>
}

export interface BetterAuthEnv {
  D1_01: D1Database
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  CLOUDFLARE_ENV?: string
  AUTH_SESSION_READ_LIMITER?: RateLimitBinding
  AUTH_SESSION_WRITE_LIMITER?: RateLimitBinding
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
    html: '<p>We received a request to reset your password.</p><p>If you requested this, use the link below to choose a new password:</p><p><a href="' + safeUrl + '">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>',
  })
}

async function activateVerifiedAccount(db: D1Database, userId: string): Promise<void> {
  const now = new Date().toISOString()
  const activation = await activateEmailVerifiedAccount(db, userId, now)

  // The account transition and canonical L2 assignment are committed in one
  // D1 batch. This idempotent guard also repairs an already-active account
  // whose verification callback previously stopped before role materialization.
  if (activation.accountState === 'ACTIVE') {
    await ensureVerifiedUserRole(db, userId, now)
  }
}

const sanitizeAuthDiagnostic = (value: string): string => value
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
  .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted-url]')
  .replace(/(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .slice(0, 240)

async function finalizeMfaAuditOperationReceiptWithRetry(
  db: D1Database,
  receiptId: string,
  events: MfaAuditReceiptEvent[],
): Promise<boolean> {
  let lastError: unknown
  // A D1 response can be lost after commit. Retrying the idempotent receipt
  // transition lets us read the committed state and avoids false UNKNOWN rows.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await finalizeMfaAuditOperationReceipt(db, receiptId, events)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('MFA_AUDIT_RECEIPT_FINALIZE_FAILED')
}

async function finalizeKnownMfaRejection(
  db: D1Database,
  receiptId: string,
  events: MfaAuditReceiptEvent[],
): Promise<void> {
  try {
    await finalizeMfaAuditOperationReceiptWithRetry(db, receiptId, events)
  } catch {
    throw APIError.from('INTERNAL_SERVER_ERROR', {
      code: 'MFA_AUDIT_UNAVAILABLE',
      message: 'MFA verification is temporarily unavailable',
    })
  }

  try {
    await reconcileMfaAuditOperationReceipts(db)
  } catch {
    // A durable READY receipt is retried by the existing W02 Cron.
    console.error(JSON.stringify({
      event: 'auth.mfa.audit_receipt_reconcile_failed',
      code: 'MFA_AUDIT_RECEIPT_RECONCILE_FAILED',
    }))
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
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const isTotpVerification = ctx.path === '/two-factor/verify-totp'
        const isBackupCodeVerification = ctx.path === '/two-factor/verify-backup-code'
        const isDisable = ctx.path === '/two-factor/disable'
        const isRecoveryRotation = ctx.path === '/two-factor/generate-backup-codes'
        if (!isTotpVerification && !isBackupCodeVerification && !isDisable && !isRecoveryRotation) return

        const body = ctx.body as { code?: unknown }
        if ((isTotpVerification || isBackupCodeVerification) && typeof body.code !== 'string') return

        // Resolve subject only from the Better Auth session or, for unauthenticated
        // sign-in challenges, a signed and unexpired server-stored two_factor
        // challenge. Never accept an audit subject from the request body.
        let subjectId: string | null = null
        let sessionSubject = false
        let sessionLookupFailed = false
        const requestHeaders = ctx.request?.headers ?? ctx.headers
        if (requestHeaders) {
          try {
            const session = await createLuckReadAuth(env).api.getSession({
              headers: requestHeaders,
              query: {},
            }) as { user?: { id?: unknown } } | null
            if (typeof session?.user?.id === 'string') {
              subjectId = session.user.id
              sessionSubject = true
            }
          } catch {
            sessionLookupFailed = true
          }
        }

        let signedChallengeSubject = false
        if (!subjectId && (isTotpVerification || isBackupCodeVerification)) {
          const challengeCookie = ctx.context.createAuthCookie('two_factor')
          const signedChallenge = await ctx.getSignedCookie(
            challengeCookie.name,
            ctx.context.secret,
          )
          if (signedChallenge) {
            const challenge = await ctx.context.internalAdapter.findVerificationValue(signedChallenge)
            if (isUnexpiredMfaChallengeRecord(challenge)) {
              subjectId = challenge.value
              signedChallengeSubject = true
            }
          }
        }
        if (!subjectId && sessionLookupFailed && (isTotpVerification || isBackupCodeVerification)) {
          // Do not silently skip replay protection when the authenticated
          // subject could not be resolved because an authority read failed.
          throw APIError.from('INTERNAL_SERVER_ERROR', {
            code: 'TOTP_REPLAY_GUARD_UNAVAILABLE',
            message: 'TOTP verification is temporarily unavailable',
          })
        }
        if (!subjectId) {
          // Every MFA mutation/challenge must have a server-derived subject. If
          // W02 cannot bind the request to a session or signed challenge, fail
          // before the plugin can consume a factor or issue a session.
          throw APIError.from('UNAUTHORIZED', {
            code: isDisable || isRecoveryRotation ? 'UNAUTHENTICATED' : 'INVALID_CODE',
            message: isDisable || isRecoveryRotation ? 'Authentication is required' : 'Invalid code',
          })
        }

        const isChallenge = signedChallengeSubject && !sessionSubject
        const mfaOperation = requestHeaders?.get('X-LuckRead-MFA-Operation')
        const suppliedReceiptId = requestHeaders?.get('X-LuckRead-MFA-Receipt-Id')
        const receiptMode = requestHeaders?.get('X-LuckRead-MFA-Receipt-Mode')
        const hasReceiptHandoffHeader = Boolean(mfaOperation || suppliedReceiptId || receiptMode)
        const isEnrollmentConfirmation = mfaOperation === 'enrollment-confirm' &&
          receiptMode === 'defer-finalization' && Boolean(suppliedReceiptId)
        if (hasReceiptHandoffHeader && (!isEnrollmentConfirmation || !isTotpVerification)) {
          throw APIError.from('FORBIDDEN', {
            code: 'MFA_AUDIT_RECEIPT_HANDOFF_INVALID',
            message: 'MFA operation could not be verified',
          })
        }

        let receiptId: string
        if (isEnrollmentConfirmation) {
          try {
            await assertMfaAuditOperationReceiptOwner(env.D1_01, {
              receiptId: suppliedReceiptId as string,
              userId: subjectId,
              operationPath: '/two-factor/verify-totp',
              isChallenge: false,
            })
            receiptId = suppliedReceiptId as string
          } catch {
            throw APIError.from('INTERNAL_SERVER_ERROR', {
              code: 'MFA_AUDIT_UNAVAILABLE',
              message: 'MFA operations are temporarily unavailable',
            })
          }
        } else {
          try {
            // Persist the secret-free intent before Better Auth can change MFA
            // state. If this fails, the operation is not allowed to proceed.
            receiptId = await createMfaAuditOperationReceipt(env.D1_01, {
              userId: subjectId,
              operationPath: ctx.path as
                | '/two-factor/verify-totp'
                | '/two-factor/verify-backup-code'
                | '/two-factor/disable'
                | '/two-factor/generate-backup-codes',
              isChallenge,
              correlationId: requestHeaders?.get('X-LuckRead-Correlation-Id'),
              causationId: requestHeaders?.get('X-LuckRead-Request-Id'),
            })
          } catch {
            throw APIError.from('INTERNAL_SERVER_ERROR', {
              code: 'MFA_AUDIT_UNAVAILABLE',
              message: 'MFA operations are temporarily unavailable',
            })
          }
        }

        setMfaAuditHookState(ctx.context, {
          userId: subjectId,
          isChallenge,
          receiptId,
        })

        // Disable and recovery-code rotation require a live session. Their
        // authority is checked by Better Auth; this hook only snapshots the
        // authenticated subject before a disable trigger can revoke that session.
        if (isDisable || isRecoveryRotation) return

        // Factor completion must never activate a suspended, pending or missing
        // account. Check W02-owned account state for TOTP and recovery paths.
        const accountActive = await isActiveMfaSubject(env.D1_01, subjectId)
        if (!accountActive) {
          if (!isEnrollmentConfirmation) {
            await finalizeKnownMfaRejection(
              env.D1_01,
              receiptId,
              isChallenge ? [{
                eventType: 'auth.mfa.challenge_failed',
                result: 'failed',
                reasonCode: 'ACCOUNT_NOT_ACTIVE',
                challengeMethod: isBackupCodeVerification ? 'recovery_code' : 'totp',
              }] : [],
            )
          }
          throw APIError.from('FORBIDDEN', {
            code: 'ACCOUNT_NOT_ACTIVE',
            message: 'Account is not eligible for authentication',
          })
        }
        // Better Auth atomically validates and consumes backup codes. The
        // persisted monotonic time-step guard applies specifically to TOTP.
        if (isBackupCodeVerification) return

        const factor = await env.D1_01.prepare(
          'SELECT secret FROM "twoFactor" WHERE userId = ? LIMIT 1',
        ).bind(subjectId).first<{ secret: string }>()
        // Let the pinned plugin produce its canonical not-enabled/challenge error.
        if (!factor) return

        const secret = await symmetricDecrypt({
          key: ctx.context.secretConfig,
          data: factor.secret,
        })
        const match = await matchTotpTimeStep(secret, body.code as string)
        // Invalid codes continue through Better Auth so its failure counters and
        // challenge lockout remain authoritative.
        if (match.kind === 'invalid') return
        if (match.kind === 'ambiguous') {
          if (!isEnrollmentConfirmation) {
            await finalizeKnownMfaRejection(
              env.D1_01,
              receiptId,
              isChallenge ? [{
                eventType: 'auth.mfa.challenge_failed',
                result: 'failed',
                reasonCode: 'AMBIGUOUS_TOTP_TIME_STEP',
                challengeMethod: 'totp',
              }] : [],
            )
          }
          throw APIError.from('UNAUTHORIZED', { code: 'INVALID_CODE', message: 'Invalid code' })
        }

        const consumed = await consumeTotpTimeStep(env.D1_01, subjectId, match.timeStep)
        if (!consumed) {
          // The TOTP was valid but its monotonically increasing step was already
          // accepted. Persist the rejection before returning the auth failure.
          try {
            await appendMfaAuditOperationReceiptEvent(env.D1_01, receiptId, {
              eventType: 'auth.mfa.replay_rejected',
              result: 'rejected',
              reasonCode: 'TOTP_STEP_ALREADY_ACCEPTED',
              challengeMethod: 'totp',
              idempotencyKey: `mfa-operation:${receiptId}:auth.mfa.replay_rejected`,
              occurredAt: new Date().toISOString(),
            })
            // This rejection is decided inside the before hook, so finalize its
            // durable audit plan here instead of depending on an after hook that
            // may not run when the hook itself throws.
            if (!isEnrollmentConfirmation) {
              await finalizeKnownMfaRejection(env.D1_01, receiptId, [])
            }
          } catch {
            throw APIError.from('INTERNAL_SERVER_ERROR', {
              code: 'MFA_AUDIT_UNAVAILABLE',
              message: 'TOTP verification is temporarily unavailable',
            })
          }
          throw APIError.from('UNAUTHORIZED', { code: 'INVALID_CODE', message: 'Invalid code' })
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!MFA_AUDIT_OBSERVED_PATHS.has(ctx.path)) return
        const state = getMfaAuditHookState(ctx.context)
        if (!state?.receiptId) return

        const requestHeaders = ctx.request?.headers ?? ctx.headers
        if (requestHeaders?.get('X-LuckRead-MFA-Operation') === 'enrollment-confirm' &&
            requestHeaders?.get('X-LuckRead-MFA-Receipt-Mode') === 'defer-finalization') {
          // The owning W02 enrollment endpoint performs authoritative factor
          // read-back before finalizing this receipt. Do not resolve a successful
          // enrollment as an empty receipt inside the nested plugin hook.
          return
        }

        const failed = isMfaAuditFailureOutcome(ctx.context.returned)
        const outcomes: MfaAuditReceiptEvent[] = classifyMfaAuditHookOutcome({
          path: ctx.path,
          isChallenge: state.isChallenge,
          failed,
        }).map((outcome) => ({ ...outcome }))

        // Include lockout as part of this operation's durable plan so it is
        // retried under the same receipt if its outbox insert temporarily fails.
        if (failed &&
            (ctx.path === '/two-factor/verify-totp' || ctx.path === '/two-factor/verify-backup-code')) {
          try {
            const factor = await env.D1_01.prepare(
              'SELECT lockedUntil FROM "twoFactor" WHERE userId = ? LIMIT 1',
            ).bind(state.userId).first<{ lockedUntil: string | null }>()
            const lockUntil = typeof factor?.lockedUntil === 'string' ? Date.parse(factor.lockedUntil) : Number.NaN
            if (Number.isFinite(lockUntil) && lockUntil > Date.now()) {
              const lockoutIdempotencyKey = 'mfa-lock:' + state.userId + ':' + lockUntil
              outcomes.push({
                eventType: 'auth.mfa.locked',
                eventId: await deriveMfaAuditEventIdForIdempotencyKey(lockoutIdempotencyKey),
                result: 'rejected',
                reasonCode: 'VERIFICATION_LOCKOUT',
                idempotencyKey: lockoutIdempotencyKey,
              })
            }
          } catch {
            console.error(JSON.stringify({
              event: 'auth.mfa.lockout_state_read_failed',
              code: 'MFA_AUDIT_STATE_READ_FAILED',
            }))
          }
        }

        try {
          // Persist the terminal outcome before trying the ordinary outbox.
          // A failed outbox insert leaves READY work for the existing W02 Cron.
          await finalizeMfaAuditOperationReceiptWithRetry(env.D1_01, state.receiptId, outcomes)
        } catch {
          // Do not turn a completed MFA mutation into a misleading failure:
          // the durable STARTED receipt will be surfaced as UNKNOWN if recovery
          // cannot establish its outcome after the stale-operation threshold.
          console.error(JSON.stringify({
            event: 'auth.mfa.audit_receipt_finalize_failed',
            code: 'MFA_AUDIT_RECEIPT_FINALIZE_FAILED',
          }))
          return
        }

        try {
          await reconcileMfaAuditOperationReceipts(env.D1_01)
        } catch {
          // The receipt is already durable; the scheduled publisher retries it.
          console.error(JSON.stringify({
            event: 'auth.mfa.audit_receipt_reconcile_failed',
            code: 'MFA_AUDIT_RECEIPT_RECONCILE_FAILED',
          }))
        }
      }),
    },
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
        const userId = String(user.id)
        await activateVerifiedAccount(env.D1_01, userId)
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await ensureBaseUserRole(env.D1_01, String(user.id), new Date().toISOString())
          },
        },
        update: {
          after: async (user) => {
            const userId = String(user.id)
            const pendingMfaEnrollment = await env.D1_01.prepare(
              'SELECT id FROM "user" WHERE id = ? AND two_factor_enabled = 1 AND mfa_enrolled_at IS NULL LIMIT 1',
            ).bind(userId).first<{ id: string }>()
            if (!pendingMfaEnrollment) return

            // The reviewed D1 lifecycle triggers are authoritative and revoke
            // sessions on every enable/disable transition. This hook is a fallback
            // for a legacy or partially migrated row with a missing enrollment time.
            const enrolledAt = new Date().toISOString()
            await env.D1_01.batch([
              env.D1_01.prepare(
                'UPDATE "user" SET mfa_enrolled_at = ? WHERE id = ? AND two_factor_enabled = 1 AND mfa_enrolled_at IS NULL',
              ).bind(enrolledAt, userId),
              env.D1_01.prepare('DELETE FROM "session" WHERE user_id = ?').bind(userId),
            ])
          },
        },
      },
    },
    user: {
      // The checked-in D1 schema deliberately uses snake_case columns.
      // Map Better Auth's camelCase core fields to those exact column names.
      fields: {
        emailVerified: 'email_verified',
        twoFactorEnabled: 'two_factor_enabled',
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
    // High-privilege layers cannot rely on a long-lived trusted-device cookie.
    // Require a new TOTP challenge during credential sign-in rather than letting
    // clients mark a device as trusted for the default 30-day window.
    plugins: [bearer(), twoFactor({
      issuer: 'LuckRead',
      trustDeviceMaxAge: 0,
      // Backup codes are recovery credentials: explicitly encrypt them at rest.
      backupCodeOptions: { storeBackupCodes: 'encrypted' },
      twoFactorCookieMaxAge: 10 * 60,
      allowPasswordless: false,
      skipVerificationOnEnable: false,
      // No email/SMS OTP sender is configured; the plugin rejects "otp"
      // enrollment when sendOTP is absent. Elevated authorization additionally
      // requires a persisted, TOTP-verified row in the twoFactor table.
      totpOptions: { allowPasswordless: false },
      // Plugin-contributed fields need the plugin schema mapping; the root
      // user.fields map alone does not rename twoFactorEnabled for this plugin.
      schema: {
        user: {
          fields: {
            twoFactorEnabled: 'two_factor_enabled',
          },
        },
      },
    })],
    advanced: {
      // H5/PC and the canonical API hostname must share the same W02 session.
      crossSubDomainCookies: {
        enabled: true,
        domain: '.luckread.com',
      },
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
