import { createLuckReadAuth, type BetterAuthEnv } from './better-auth.js'
import {
  createD1MfaAuditOperationReceiptStore,
  type MfaAuditOperationReceiptStore,
} from './mfa-audit-operation-receipt-store.js'
import {
  createD1MfaEnrollmentConfirmStore,
  type MfaEnrollmentConfirmStore,
} from './mfa-enrollment-confirm-store.js'
import { resolveBetterAuthPrincipal } from './principal.js'
import {
  createD1MfaStatusStore,
  type MfaStatusStore,
  type AuthoritativeMfaStatus,
} from './mfa-status.js'

const json = (body: unknown, status = 200): Response => Response.json(body, {
  status,
  headers: { 'cache-control': 'no-store' },
})

type AuthHandler = Pick<ReturnType<typeof createLuckReadAuth>, 'handler'>

export type MfaEnrollmentConfirmHandlerDependencies = {
  store?: MfaEnrollmentConfirmStore
  receiptStore?: MfaAuditOperationReceiptStore
  statusStore?: MfaStatusStore
  auth?: AuthHandler
  resolvePrincipal?: typeof resolveBetterAuthPrincipal
}

async function finalizeEnrollmentAuditReceipt(
  receiptStore: MfaAuditOperationReceiptStore,
  receiptId: string,
  event: Parameters<MfaAuditOperationReceiptStore['finalize']>[1][number],
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await receiptStore.finalize(receiptId, [event])
      try {
        // A durable READY receipt is sufficient for safe response behavior;
        // the existing W02 scheduled publisher can retry reconciliation.
        await receiptStore.reconcile()
      } catch {
        console.error(JSON.stringify({
          event: 'auth.mfa.enrollment_receipt_reconcile_deferred',
          code: 'MFA_AUDIT_RECEIPT_RECONCILE_FAILED',
        }))
      }
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('MFA_AUDIT_RECEIPT_FINALIZE_FAILED')
}

const enrollmentFailureEvent = () => ({
  eventType: 'auth.mfa.enrollment_failed' as const,
  operationId: 'authMfaEnrollmentConfirm' as const,
  result: 'failed' as const,
  reasonCode: 'ENROLLMENT_CONFIRMATION_REJECTED',
})

const enrollmentSuccessEvent = (occurredAt: string) => ({
  eventType: 'auth.mfa.enrollment_verified' as const,
  result: 'succeeded' as const,
  reasonCode: 'TOTP_ENROLLMENT_VERIFIED',
  factorState: 'ENABLED' as const,
  occurredAt,
})

/**
 * Resolve a transport/server error only when the W02-owned factor read-back
 * proves an outcome. An indeterminate read-back leaves the receipt STARTED so
 * the existing stale-receipt path can surface UNKNOWN without inventing success
 * or failure.
 */
async function reconcileAmbiguousEnrollmentOutcome(
  receiptStore: MfaAuditOperationReceiptStore,
  statusStore: MfaStatusStore,
  receiptId: string,
  userId: string,
): Promise<'succeeded' | 'failed' | 'unknown'> {
  let status: AuthoritativeMfaStatus | null
  try {
    status = await statusStore.read(userId, new Date())
  } catch {
    return 'unknown'
  }
  if (status?.enabled && status.verified && status.enrolledAt) {
    await finalizeEnrollmentAuditReceipt(receiptStore, receiptId, enrollmentSuccessEvent(status.enrolledAt))
    return 'succeeded'
  }
  if (status && (!status.enabled || !status.verified)) {
    await finalizeEnrollmentAuditReceipt(receiptStore, receiptId, enrollmentFailureEvent())
    return 'failed'
  }
  return 'unknown'
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * W02-owned enrollment confirmation. W02 derives the subject from the live
 * session, verifies the pending factor through Better Auth, and returns only
 * a read-back of the authoritative status. Persistence providers are injected
 * for rehearsal; deployed callers continue to use D1 and Better Auth by default.
 */
export async function handleMfaEnrollmentConfirmRequest(
  env: BetterAuthEnv,
  request: Request,
  dependencies: MfaEnrollmentConfirmHandlerDependencies = {},
): Promise<Response> {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
  ) {
    return json({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!/^[A-Za-z0-9._:-]{16,255}$/.test(idempotencyKey)) {
    return json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'valid Idempotency-Key required' } }, 400)
  }

  let principal
  try {
    principal = await (dependencies.resolvePrincipal ?? resolveBetterAuthPrincipal)(env, request)
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
  }
  if (!principal || principal.accountState !== 'ACTIVE') {
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
  }

  let body: { code?: unknown }
  try {
    body = await request.json() as typeof body
  } catch {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid MFA confirmation request' } }, 400)
  }
  if (!body || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'a six-digit TOTP code is required' } }, 400)
  }

  const store = dependencies.store ?? createD1MfaEnrollmentConfirmStore(env.D1_01)
  const statusStore = dependencies.statusStore ?? createD1MfaStatusStore(env.D1_01)
  const receiptStore = dependencies.receiptStore ?? createD1MfaAuditOperationReceiptStore(env.D1_01)
  const auth = dependencies.auth ?? createLuckReadAuth(env)

  try {
    const pending = await store.read(principal.userId)
    if (!pending || pending.factorVerified === null) {
      return json({ error: { code: 'ENROLLMENT_NOT_PENDING', message: 'MFA enrollment is not pending' } }, 409)
    }

    const keyHash = await sha256Hex(idempotencyKey)
    // Include the key in the request fingerprint so a replay with the same key
    // and same code can recover status without re-consuming TOTP; never persist
    // the short six-digit code or an unkeyed hash of the code alone.
    const requestHash = await sha256Hex(idempotencyKey + '\0' + body.code)

    if (pending.userEnabled && pending.factorVerified) {
      if (pending.confirmationKeyHash === keyHash &&
          pending.confirmationRequestHash === requestHash) {
        const status = await statusStore.read(principal.userId, new Date())
        if (status?.enabled && status.verified && status.enrolledAt) return json({ data: status })
      }
      return json({
        error: {
          code: pending.confirmationKeyHash === keyHash
            ? 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
            : 'FACTOR_ALREADY_VERIFIED',
          message: 'MFA enrollment confirmation cannot be repeated with different input',
        },
      }, 409)
    }
    if (pending.userEnabled || pending.factorVerified) {
      return json({ error: { code: 'FACTOR_ALREADY_VERIFIED', message: 'MFA enrollment must not replace a verified factor' } }, 409)
    }

    let receiptId: string
    try {
      // Persist the secret-free operation receipt before Better Auth mutates
      // the factor. The nested hook must validate and reuse this same receipt.
      receiptId = await receiptStore.create({
        userId: principal.userId,
        operationPath: '/two-factor/verify-totp',
        isChallenge: false,
        correlationId: request.headers.get('X-LuckRead-Correlation-Id'),
        causationId: request.headers.get('X-LuckRead-Request-Id'),
      })
    } catch {
      return json({ error: { code: 'MFA_AUDIT_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
    }

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    headers.set('content-type', 'application/json; charset=utf-8')
    headers.set('X-LuckRead-MFA-Operation', 'enrollment-confirm')
    headers.set('X-LuckRead-MFA-Receipt-Id', receiptId)
    headers.set('X-LuckRead-MFA-Receipt-Mode', 'defer-finalization')
    const authRequest = new Request('https://luckread.com/api/auth/two-factor/verify-totp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ code: body.code, trustDevice: false }),
    })
    // The upstream body contains a session token and is deliberately discarded.
    // A rotated session can be delivered only through the HTTP-only Set-Cookie
    // header, and only after the authoritative read-back succeeds.
    let verified: Response
    try {
      verified = await auth.handler(authRequest)
    } catch {
      try {
        await reconcileAmbiguousEnrollmentOutcome(receiptStore, statusStore, receiptId, principal.userId)
      } catch {
        return json({ error: { code: 'MFA_AUDIT_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
      }
      // No upstream response means there is no safe session-cookie envelope to
      // forward. A proven state is audited; an unproven state stays STARTED.
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
    }
    if (!verified.ok) {
      if (verified.status >= 500) {
        try {
          await reconcileAmbiguousEnrollmentOutcome(receiptStore, statusStore, receiptId, principal.userId)
        } catch {
          return json({ error: { code: 'MFA_AUDIT_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
        }
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
      }
      try {
        await finalizeEnrollmentAuditReceipt(receiptStore, receiptId, enrollmentFailureEvent())
      } catch {
        return json({ error: { code: 'MFA_AUDIT_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
      }
      if (verified.status === 429) {
        return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, 429)
      }
      if (verified.status === 401) {
        return json({ error: { code: 'MFA_CODE_INVALID', message: 'MFA confirmation failed' } }, 401)
      }
      return json({ error: { code: 'MFA_CONFIRM_REJECTED', message: 'MFA confirmation failed' } }, 400)
    }

    const status = await statusStore.read(principal.userId, new Date())
    if (!status || !status.enabled || !status.verified || !status.enrolledAt) {
      return json({ error: { code: 'MFA_READBACK_FAILED', message: 'MFA confirmation could not be verified' } }, 503)
    }

    try {
      await finalizeEnrollmentAuditReceipt(receiptStore, receiptId, enrollmentSuccessEvent(status.enrolledAt))
    } catch {
      return json({ error: { code: 'MFA_AUDIT_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
    }
    const stored = await store.persistConfirmation({ userId: principal.userId, keyHash, requestHash })
    if (!stored) {
      return json({ error: { code: 'MFA_READBACK_FAILED', message: 'MFA confirmation could not be verified' } }, 503)
    }
    // Better Auth rotates the authenticated session after verified enrollment.
    // Forward only its Set-Cookie headers after W02 read-back, the receipt and
    // the idempotency marker have succeeded. Never expose the upstream token.
    const response = json({ data: status })
    const upstreamHeaders = verified.headers as Headers & { getSetCookie?: () => string[] }
    const setCookies = typeof upstreamHeaders.getSetCookie === 'function'
      ? upstreamHeaders.getSetCookie.call(verified.headers)
      : (verified.headers.get('set-cookie') ? [verified.headers.get('set-cookie') as string] : [])
    for (const cookie of setCookies) response.headers.append('set-cookie', cookie)
    return response
  } catch {
    return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'MFA confirmation unavailable' } }, 503)
  }
}
