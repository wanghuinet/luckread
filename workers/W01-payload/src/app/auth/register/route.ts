import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import priv004DevPolicy from '../../../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'
import priv004ProdPolicy from '../../../../../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'
import { getW01RegistrationPersistenceStore } from '../../../auth/registration-persistence.js'
import { proxyBetterAuth, rollbackRegistrationUser } from '../../../auth/w02-session-client.js'
import type { User as PayloadUser } from '../../../payload-types'

const ACCOUNT_STATE = 'PENDING_VERIFICATION'
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

type AuthRegisterRequest = {
  identityType?: unknown
  identity?: unknown
  credential?: unknown
  username?: unknown
  consent?: unknown
}

type RegistrationResponse = {
  userId: string
  accountState: typeof ACCOUNT_STATE
}


const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })

const errorResponse = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  json(
    {
      error: { code, message, details: {} },
      requestId: `req_${crypto.randomUUID()}`,
    },
    status,
    headers,
  )

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const betterAuthFailureDiagnostic = (value: unknown): { failureCategory: string } => {
  const root = isRecord(value) ? value : {}
  const error = isRecord(root.error) ? root.error : root
  const rawCode = typeof error.code === 'string' ? error.code : ''
  const code = /^[A-Z0-9_.-]{1,80}$/i.test(rawCode) ? rawCode : ''
  const message =
    typeof error.message === 'string'
      ? error.message
      : typeof root.message === 'string'
        ? root.message
        : ''
  const signal = `${code} ${message}`.toLowerCase()

  const failureCategory =
    /password/.test(signal) && /(short|long|length|minimum|maximum|weak|policy|required)/.test(signal)
      ? 'PASSWORD_POLICY'
      : /(already exists|already registered|user exists|email exists|username.*taken|duplicate|user_already_exists|username_taken|email_taken)/.test(signal)
        ? 'IDENTITY_CONFLICT'
        : /(origin|csrf|cross.?site|trusted.?origin)/.test(signal)
          ? 'ORIGIN_OR_CSRF_REJECTION'
          : /username/.test(signal)
            ? 'USERNAME_VALIDATION'
            : /email/.test(signal)
              ? 'EMAIL_VALIDATION'
              : /(invalid|required|validation|missing)/.test(signal)
                ? 'INPUT_VALIDATION'
                : 'UNCLASSIFIED'

  return { failureCategory }
}

const isExpired = (expiresAt: string, now: Date) => {
  const value = Date.parse(expiresAt)
  return !Number.isFinite(value) || value <= now.getTime()
}

const parseReplay = (value: ExistingEnvelope['committedResponse']): RegistrationResponse | null => {
  if (!value) return null

  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return null
    }
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { userId?: unknown }).userId !== 'string' ||
    (parsed as { accountState?: unknown }).accountState !== ACCOUNT_STATE
  ) {
    return null
  }

  return {
    userId: (parsed as { userId: string }).userId,
    accountState: ACCOUNT_STATE,
  }
}

const isUniqueConstraintError = (error: unknown) => {
  const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {}
  if (value.code === '23505') return true
  const message = typeof value.message === 'string' ? value.message : String(error)
  return /unique constraint|unique constraint failed|duplicate/i.test(message)
}

const validatePolicy = (now: Date) => {
  const runtimeEnvironment = process.env.CLOUDFLARE_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  const priv004Policy = runtimeEnvironment.toLowerCase() === 'production' ? priv004ProdPolicy : priv004DevPolicy
  if (
    priv004Policy.status !== 'APPROVED' ||
    (runtimeEnvironment.toLowerCase() === 'production'
      ? priv004Policy.environment !== 'PRODUCTION' || priv004Policy.usage.productionUse !== true
      : priv004Policy.environment !== 'DEVELOPMENT' || priv004Policy.usage.productionUse !== false) ||
    priv004Policy.rule.mode !== 'DURATION' ||
    !Number.isSafeInteger(priv004Policy.rule.durationSeconds) ||
    priv004Policy.rule.durationSeconds <= 0 ||
    priv004Policy.scope.operationId !== ENDPOINT ||
    priv004Policy.scope.purpose !== SCOPE
  ) throw new Error('PRIV004_POLICY_NOT_ADMISSIBLE')

  const effectiveFrom = Date.parse(priv004Policy.effectiveFrom)
  const effectiveTo = priv004Policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(priv004Policy.effectiveTo)
  if (!Number.isFinite(effectiveFrom) || (!Number.isFinite(effectiveTo) && effectiveTo !== Number.POSITIVE_INFINITY) || now.getTime() < effectiveFrom || now.getTime() > effectiveTo) {
    throw new Error('PRIV004_POLICY_OUTSIDE_WINDOW')
  }

  return {
    policyVersion: priv004Policy.policyVersion,
    retentionClass: 'LEGAL_AUDIT' as const,
    retentionUntil: new Date(now.getTime() + priv004Policy.rule.durationSeconds * 1000).toISOString(),
    sourceAuthority: priv004Policy.sourceAuthority,
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REGISTER_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey) return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  if (idempotencyKey.length > 255) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
  let body: unknown
  try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
  if (!isRecord(body) || !isRecord(body.consent)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')

  const identityType = body.identityType
  const identity = body.identity
  const credential = body.credential
  const username = body.username
  const consent = body.consent
  if (identityType !== 'email') {
    return errorResponse(422, 'IDENTITY_TYPE_UNSUPPORTED', '目前仅支持使用邮箱注册。')
  }
  if (typeof identity !== 'string' || identity.trim().length === 0) {
    return errorResponse(422, 'EMAIL_REQUIRED', '请输入邮箱地址。')
  }
  if (
    identity.trim().length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity.trim())
  ) {
    return errorResponse(422, 'EMAIL_INVALID', '邮箱格式不正确，请检查后重试。')
  }
  if (typeof credential !== 'string' || credential.length === 0) {
    return errorResponse(422, 'PASSWORD_REQUIRED', '请输入登录密码。')
  }
  const credentialLength = credential.length
  if (credentialLength < 15 || credentialLength > 128) {
    return errorResponse(422, 'PASSWORD_LENGTH_INVALID', '密码长度必须为 15–128 个字符。')
  }
  if (typeof username !== 'string' || username.trim().length === 0) {
    return errorResponse(422, 'USERNAME_REQUIRED', '请输入用户名。')
  }
  if (!/^[A-Za-z0-9]{6,32}$/.test(username.trim())) {
    return errorResponse(422, 'USERNAME_INVALID', '用户名需为 6–32 位英文字母或数字，不能包含空格或特殊字符。')
  }
  if (
    consent.purpose !== SCOPE ||
    typeof consent.policyVersion !== 'string' || consent.policyVersion.length === 0 ||
    Object.keys(consent).some((key) => !['purpose', 'policyVersion'].includes(key))
  ) return errorResponse(422, 'CONSENT_INVALID', '请确认已同意当前用户协议和隐私政策后再注册。')

  const now = new Date()
  let policy: ReturnType<typeof validatePolicy>
  try { policy = validatePolicy(now) } catch { return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration policy is unavailable') }
  if (consent.policyVersion !== policy.policyVersion) return errorResponse(422, 'VALIDATION_FAILED', 'Consent policyVersion is not admitted for registration')

  const normalized = {
    identityType: 'email',
    identity: identity.trim().toLowerCase(),
    credential,
    username: username.trim(),
    consent: { purpose: SCOPE, policyVersion: consent.policyVersion },
  }
  const payloadHash = await sha256Hex(JSON.stringify(canonicalize(normalized)))
  const responseDigest = await sha256Hex(
    JSON.stringify(
      canonicalize({
        schema: 'AUTH-001.response-digest.v1',
        operationId: 'authRegister',
        endpoint: '/auth/register',
        idempotencyKey,
        payloadHash,
        status: 201,
        accountState: ACCOUNT_STATE,
      }),
    ),
  )
  const { env } = await getCloudflareContext({ async: true })
  let persistence: ReturnType<typeof getW01RegistrationPersistenceStore>
  try {
    persistence = getW01RegistrationPersistenceStore(
      env as unknown as Parameters<typeof getW01RegistrationPersistenceStore>[0],
    )
  } catch (error) {
    console.error(JSON.stringify({
      event: 'auth.register.persistence_unavailable',
      diagnosticCode: 'AUTH001_PERSISTENCE_UNAVAILABLE',
      databaseDriver: (env as unknown as { PAYLOAD_DATABASE_DRIVER?: string }).PAYLOAD_DATABASE_DRIVER ?? 'd1',
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  let existing: Awaited<ReturnType<typeof persistence.getExistingEnvelope>>
  try {
    existing = await persistence.getExistingEnvelope(idempotencyKey)
  } catch (error) {
    console.error(JSON.stringify({
      event: 'auth.register.envelope_read_failure',
      diagnosticCode: 'AUTH001_ENVELOPE_READ_FAILURE',
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }
  if (existing && !isExpired(existing.expiresAt, now)) {
    if (existing.payloadHash !== payloadHash) return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
    if (existing.state === 'IN_PROGRESS') return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
    if (existing.state === 'COMPLETED') {
      const replay = parseReplay(existing.committedResponse)
      return replay
        ? json({ ...replay, requestId: `req_${crypto.randomUUID()}` }, 201)
        : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
    }
    return errorResponse(409, 'CONFLICT', 'The prior registration attempt is not replayable')
  }

  const reservationId = crypto.randomUUID()
  const consentRecordId = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  try {
    await persistence.reserveEnvelope({
      reservationId,
      idempotencyKey,
      payloadHash,
      responseDigest,
      consentRecordId,
      expiresAt,
      now: now.toISOString(),
      existing,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isUniqueConstraintError(error) && /auth_registration_envelopes|active_key/i.test(message)) {
      let current: Awaited<ReturnType<typeof persistence.getExistingEnvelope>>
      try {
        current = await persistence.getExistingEnvelope(idempotencyKey)
      } catch (readError) {
        console.error(JSON.stringify({
          event: 'auth.register.envelope_conflict_reread_failure',
          diagnosticCode: 'AUTH001_ENVELOPE_REREAD_FAILURE',
          errorName: readError instanceof Error ? readError.name : typeof readError,
        }))
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
      }
      if (current && current.payloadHash !== payloadHash) {
        return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
      }
      if (current?.state === 'IN_PROGRESS') {
        return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
      }
      if (current?.state === 'COMPLETED') {
        const replay = parseReplay(current.committedResponse)
        return replay
          ? json({ ...replay, requestId: `req_${crypto.randomUUID()}` }, 201)
          : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
      }
      return errorResponse(409, 'CONFLICT', 'The prior registration attempt is not replayable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const releaseReservation = async (): Promise<void> => {
    try {
      await persistence.releaseReservation(reservationId)
    } catch (error) {
      console.error(JSON.stringify({
        event: 'auth.register.reservation_release_failure',
        diagnosticCode: 'AUTH001_RESERVATION_RELEASE_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }))
    }
  }

  let authResponse: Response
  try {
    authResponse = await proxyBetterAuth(request, '/sign-up/email', {
      body: {
        email: normalized.identity,
        name: normalized.username,
        username: normalized.username,
        password: normalized.credential,
      },
    })
  } catch {
    await releaseReservation()
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  let authPayload: unknown = null
  try { authPayload = await authResponse.json() } catch {}
  if (!authResponse.ok) {
    await releaseReservation()
    const upstreamError = isRecord(authPayload) && isRecord(authPayload.error)
      ? authPayload.error
      : isRecord(authPayload) ? authPayload : {}
    const rawCode = typeof upstreamError.code === 'string' ? upstreamError.code : ''
    const upstreamCode = /^[A-Z0-9_]{1,80}$/.test(rawCode) ? rawCode : 'UNKNOWN'
    const diagnostic = betterAuthFailureDiagnostic(authPayload)
    console.warn(JSON.stringify({
      event: 'auth.register.upstream_rejection',
      diagnosticCode: 'AUTH001_UPSTREAM_REJECTION',
      cfRay: request.headers.get('cf-ray') ?? null,
      upstreamStatus: authResponse.status,
      upstreamCode,
      failureCategory: diagnostic.failureCategory,
    }))
    if (upstreamCode === 'PASSWORD_TOO_SHORT') {
      return errorResponse(422, 'PASSWORD_TOO_SHORT', '密码长度必须为 15–128 位')
    }
    if (authResponse.status === 403 || upstreamCode === 'INVALID_ORIGIN') {
      return errorResponse(403, 'INVALID_ORIGIN', '当前访问来源未获授权')
    }
    return errorResponse(
      authResponse.status >= 500 ? 503 : 422,
      authResponse.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'VALIDATION_FAILED',
      authResponse.status >= 500 ? 'Registration service unavailable' : 'Registration could not be completed',
    )
  }

  const betterAuthUser =
    authPayload && typeof authPayload === 'object'
      ? (authPayload as { user?: { id?: unknown; email?: unknown; username?: unknown } }).user
      : undefined
  const userId = typeof betterAuthUser?.id === 'string' ? betterAuthUser.id : ''
  if (!userId) {
    await releaseReservation()
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration identity is unavailable')
  }

  // Better Auth intentionally returns a synthetic user for duplicate-email
  // sign-up when email verification is required. Never treat an ID in that
  // response as proof that W02 persisted a real identity. The Neon adapter
  // performs this read against the same D1-01 PostgreSQL primary.
  let persistedIdentity: { id: string; email: string; username: string | null } | null = null
  try {
    persistedIdentity = await persistence.findIdentityById(userId)
  } catch (error) {
    await releaseReservation()
    console.error(JSON.stringify({
      event: 'auth.register.identity_confirmation_failure',
      diagnosticCode: 'AUTH001_IDENTITY_CONFIRMATION_FAILURE',
      cfRay: request.headers.get('cf-ray') ?? null,
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  if (
    !persistedIdentity ||
    persistedIdentity.email.trim().toLowerCase() !== normalized.identity ||
    String(persistedIdentity.username ?? '').trim() !== normalized.username
  ) {
    // Better Auth can return a synthetic identity for an email that is already
    // registered while verification is required. Check by normalized email so
    // the UI can guide the user without treating the synthetic ID as persisted.
    try {
      const identityByEmail = await persistence.findIdentityByEmail(normalized.identity)
      if (identityByEmail && identityByEmail.id !== userId) {
        await releaseReservation()
        return errorResponse(409, 'EMAIL_ALREADY_REGISTERED', '该邮箱可能已注册，请尝试登录或使用“忘记密码”找回账号。')
      }
    } catch (error) {
      await releaseReservation()
      console.error(JSON.stringify({
        event: 'auth.register.duplicate_identity_check_failure',
        diagnosticCode: 'AUTH001_DUPLICATE_IDENTITY_CHECK_FAILURE',
        cfRay: request.headers.get('cf-ray') ?? null,
        errorName: error instanceof Error ? error.name : typeof error,
      }))
      return errorResponse(503, 'SERVICE_UNAVAILABLE', '注册服务暂时不可用，请稍后重试。')
    }
    await releaseReservation()
    console.warn(JSON.stringify({
      event: 'auth.register.identity_not_persisted',
      diagnosticCode: 'AUTH001_IDENTITY_NOT_PERSISTED',
      cfRay: request.headers.get('cf-ray') ?? null,
    }))
    return errorResponse(422, 'VALIDATION_FAILED', 'Registration could not be completed')
  }

  let payload: Awaited<ReturnType<typeof getPayload>> | null = null
  let profileProjectionId: string | number | null = null

  // The Payload profile is a projection of the W02 identity. Any failure
  // after this insert must remove this projection as well as the W02 identity.
  const rollbackPayloadProfile = async (): Promise<void> => {
    const payloadClient = payload ?? await getPayload({ config })
    let targetId = profileProjectionId
    if (targetId === null) {
      const existingProfile = await payloadClient.find({
        collection: 'users',
        where: { identityId: { equals: userId } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        req: request,
      })
      targetId = existingProfile.docs[0]?.id ?? null
    }

    if (targetId !== null) {
      await payloadClient.delete({
        collection: 'users',
        id: targetId,
        overrideAccess: true,
        disableTransaction: true,
        req: request,
      })
      profileProjectionId = null
    }
  }

  try {
    payload = await getPayload({ config })
    // Import the generated collection type directly so Next's isolated route
    // type-checker includes Payload's module augmentation for auth fields.
    const existingUsername = await payload.find({
      collection: 'users',
      where: { username: { equals: normalized.username } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req: request,
    })
    if (existingUsername.docs.length > 0) {
      throw new Error('AUTH001_USERNAME_TAKEN')
    }

    const profileData: Pick<PayloadUser, 'identityId' | 'username'> & { email: string } = {
      identityId: userId,
      email: normalized.identity,
      username: normalized.username,
    }
    const createdProfile = await payload.create({
      collection: 'users',
      data: profileData,
      overrideAccess: true,
      disableTransaction: true,
      req: request,
    })
    profileProjectionId = createdProfile.id
  } catch (error) {
    try {
      await rollbackPayloadProfile()
    } catch (projectionRollbackError) {
      console.error(JSON.stringify({
        event: 'auth.register.profile_projection_rollback_failure',
        diagnosticCode: 'AUTH001_PROFILE_PROJECTION_ROLLBACK_FAILURE',
        errorName: projectionRollbackError instanceof Error ? projectionRollbackError.name : typeof projectionRollbackError,
      }))
    }
    try {
      await rollbackRegistrationUser(request, {
        userId,
        email: normalized.identity,
        username: normalized.username,
      })
    } catch (rollbackError) {
      console.error(JSON.stringify({
        event: 'auth.register.rollback_failure',
        diagnosticCode: 'AUTH001_ROLLBACK_FAILURE',
        errorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
      }))
    }
    await releaseReservation()
    const rawProjectionErrorMessage = error instanceof Error ? error.message : 'non-error throwable'
    const safeProjectionErrorMessage = rawProjectionErrorMessage
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/\b(password|credential|token)\s*[:=]\s*\S+/gi, '$1=[redacted]')
      .slice(0, 200)
    console.error(JSON.stringify({
      event: 'auth.register.profile_projection_failure',
      diagnosticCode: 'AUTH001_PROFILE_PROJECTION_FAILURE',
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: safeProjectionErrorMessage,
    }))
    // The read-before-write check improves the common path; the database's
    // unique constraint remains authoritative under concurrent registrations.
    const projectionErrorMessage = error instanceof Error ? error.message : ''
    if (projectionErrorMessage === 'LUCKREAD_USERNAME_RESERVED') {
      return errorResponse(409, 'USERNAME_RESERVED', '该用户名曾被使用，不能重新分配。')
    }
    const usernameConflict = error instanceof Error && (
      error.message === 'AUTH001_USERNAME_TAKEN' ||
      (isUniqueConstraintError(error) && /username/i.test(error.message))
    )
    if (usernameConflict) {
      return errorResponse(409, 'USERNAME_TAKEN', '该用户名已被使用，请换一个用户名。')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const committedResponseFinal = JSON.stringify({ userId, accountState: ACCOUNT_STATE })

  try {
    const committedResponse = await persistence.completeRegistration({
      reservationId,
      consentRecordId,
      userId,
      policyVersion: policy.policyVersion,
      retentionUntil: policy.retentionUntil,
      sourceAuthority: policy.sourceAuthority,
      committedResponse: committedResponseFinal,
      now: now.toISOString(),
    })
    if (typeof committedResponse !== 'string') {
      throw new Error('AUTH001_COMMITTED_RESPONSE_UNAVAILABLE')
    }

    const responseBody = parseReplay(committedResponse)
    if (!responseBody) {
      throw new Error('AUTH001_COMMITTED_RESPONSE_INVALID')
    }

    return json({ ...responseBody, requestId: `req_${crypto.randomUUID()}` }, 201)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isUniqueConstraintError(error)) {
      const failureCategory =
        /auth_registration_envelopes|active_key/i.test(message)
          ? 'IDEMPOTENCY_CONFLICT'
          : /consents/i.test(message)
            ? 'CONSENT_CONSTRAINT'
            : /users/i.test(message)
              ? 'PAYLOAD_USER_CONSTRAINT'
              : 'UNCLASSIFIED_UNIQUE_CONSTRAINT'
      console.error(JSON.stringify({
        event: 'auth.register.commit_conflict',
        diagnosticCode: 'AUTH001_COMMIT_CONFLICT',
        failureCategory,
      }))
      try {
        await rollbackPayloadProfile()
      } catch (projectionRollbackError) {
        console.error(JSON.stringify({
          event: 'auth.register.profile_projection_rollback_failure',
          diagnosticCode: 'AUTH001_PROFILE_PROJECTION_ROLLBACK_FAILURE',
          errorName: projectionRollbackError instanceof Error ? projectionRollbackError.name : typeof projectionRollbackError,
        }))
      }
      await rollbackRegistrationUser(request, {
        userId,
        email: normalized.identity,
        username: normalized.username,
      }).catch((rollbackError) => {
        console.error(JSON.stringify({
          event: 'auth.register.rollback_failure',
          diagnosticCode: 'AUTH001_ROLLBACK_FAILURE',
          errorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
        }))
      })
      await releaseReservation()
      return errorResponse(
        /auth_registration_envelopes|active_key/i.test(message)
          ? 409
          : 422,
        /auth_registration_envelopes|active_key/i.test(message)
          ? 'IDEMPOTENCY_IN_PROGRESS'
          : 'VALIDATION_FAILED',
        /auth_registration_envelopes|active_key/i.test(message)
          ? 'A registration with this Idempotency-Key is already in progress'
          : 'Registration could not be completed',
        /auth_registration_envelopes|active_key/i.test(message)
          ? { 'retry-after': '1' }
          : {},
      )
    }

    try {
      await rollbackPayloadProfile()
    } catch (projectionRollbackError) {
      console.error(JSON.stringify({
        event: 'auth.register.profile_projection_rollback_failure',
        diagnosticCode: 'AUTH001_PROFILE_PROJECTION_ROLLBACK_FAILURE',
        errorName: projectionRollbackError instanceof Error ? projectionRollbackError.name : typeof projectionRollbackError,
      }))
    }
    try {
      await rollbackRegistrationUser(request, {
        userId,
        email: normalized.identity,
        username: normalized.username,
      })
    } catch (rollbackError) {
      console.error(JSON.stringify({
        event: 'auth.register.rollback_failure',
        diagnosticCode: 'AUTH001_ROLLBACK_FAILURE',
        errorName: rollbackError instanceof Error ? rollbackError.name : typeof rollbackError,
      }))
    }
    await releaseReservation()

    console.error(
      JSON.stringify({
        event: 'auth.register.batch_failure',
        diagnosticCode: 'AUTH001_D1_BATCH_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )

    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }
}
