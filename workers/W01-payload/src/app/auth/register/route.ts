import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import priv004DevPolicy from '../../../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'
import priv004ProdPolicy from '../../../../../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'
import { proxyBetterAuth, rollbackRegistrationUser } from '../../../auth/w02-session-client.js'

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
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

type ExistingEnvelope = {
  id: string
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse?: { userId?: unknown; accountState?: unknown } | null
  expiresAt: string
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
      requestId: crypto.randomUUID(),
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

const betterAuthFailureDiagnostic = (value: unknown) => {
  const root = isRecord(value) ? value : {}
  const error = isRecord(root.error) ? root.error : root
  const rawCode = typeof error.code === 'string' ? error.code : null
  const upstreamErrorCode =
    rawCode && /^[A-Z0-9_.-]{1,80}$/i.test(rawCode) ? rawCode : null
  const message =
    typeof error.message === 'string'
      ? error.message
      : typeof root.message === 'string'
        ? root.message
        : ''
  const signal = `${upstreamErrorCode ?? ''} ${message}`.toLowerCase()

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

  return { upstreamErrorCode, failureCategory }
}

type D1Binding = Awaited<ReturnType<typeof getCloudflareContext>>['env']['D1']

const isExpired = (expiresAt: string, now: Date) => {
  const value = Date.parse(expiresAt)
  return !Number.isFinite(value) || value <= now.getTime()
}

const getExistingEnvelope = async (db: D1Binding, idempotencyKey: string): Promise<ExistingEnvelope | null> => {
  return db
    .prepare(
      `
        SELECT
          id,
          payload_hash AS payloadHash,
          state,
          committed_response AS committedResponse,
          expires_at AS expiresAt
        FROM auth_registration_envelopes
        WHERE idempotency_key = ?
          AND scope = ?
          AND endpoint = ?
        ORDER BY created_at DESC
        LIMIT 1
      `,
    )
    .bind(idempotencyKey, SCOPE, ENDPOINT)
    .first<ExistingEnvelope>()
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
  const message = error instanceof Error ? error.message : String(error)
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
  if (!idempotencyKey || idempotencyKey.length > 255) return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  let body: unknown
  try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
  if (!isRecord(body) || !isRecord(body.consent)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')

  const identityType = body.identityType
  const identity = body.identity
  const credential = body.credential
  const username = body.username
  const consent = body.consent
  if (
    identityType !== 'email' ||
    typeof identity !== 'string' || identity.trim().length === 0 ||
    typeof credential !== 'string' || credential.length === 0 ||
    typeof username !== 'string' || username.trim().length === 0 || username.length > 128 ||
    consent.purpose !== SCOPE ||
    typeof consent.policyVersion !== 'string' || consent.policyVersion.length === 0 ||
    Object.keys(consent).some((key) => !['purpose', 'policyVersion'].includes(key))
  ) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')

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
  const existing = await getExistingEnvelope(env.D1, idempotencyKey)
  if (existing && !isExpired(existing.expiresAt, now)) {
    if (existing.payloadHash !== payloadHash) return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
    if (existing.state === 'IN_PROGRESS') return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
    if (existing.state === 'COMPLETED') {
      const replay = parseReplay(existing.committedResponse)
      return replay ? json(replay, 201) : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
    }
    return errorResponse(409, 'REGISTRATION_RETRY_REQUIRED', 'The prior registration attempt is not replayable')
  }

  const reservationId = crypto.randomUUID()
  const consentRecordId = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const committedAt = now.toISOString()
  try {
    const reservationStatements = []
    if (existing && isExpired(existing.expiresAt, now)) {
      reservationStatements.push(
        env.D1
          .prepare(
            `DELETE FROM auth_registration_envelopes
             WHERE id = ?
               AND active_key = ?
               AND expires_at <= ?`,
          )
          .bind(existing.id, idempotencyKey, now.toISOString()),
      )
    }
    reservationStatements.push(
      env.D1
        .prepare(
          `INSERT INTO auth_registration_envelopes (
            id,
            idempotency_key,
            active_key,
            scope,
            endpoint,
            payload_hash,
            state,
            response_digest,
            committed_response,
            expires_at,
            consent_record_id,
            updated_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, NULL, ?, ?, ?, ?)`,
        )
        .bind(
          reservationId,
          idempotencyKey,
          idempotencyKey,
          SCOPE,
          ENDPOINT,
          payloadHash,
          responseDigest,
          expiresAt,
          consentRecordId,
          committedAt,
          committedAt,
        ),
    )
    const result = await env.D1.batch(reservationStatements)
    const insertIndex = reservationStatements.length - 1
    if (
      result.length !== reservationStatements.length ||
      (existing && isExpired(existing.expiresAt, now) && result[0]?.meta?.changes !== 1) ||
      result[insertIndex]?.meta?.changes !== 1
    ) {
      throw new Error('AUTH001_IDEMPOTENCY_RESERVATION_INCOMPLETE')
    }
  } catch (error) {
    if (isUniqueConstraintError(error) && /auth_registration_envelopes|active_key/i.test(String(error instanceof Error ? error.message : error))) {
      const current = await getExistingEnvelope(env.D1, idempotencyKey)
      if (current && current.payloadHash !== payloadHash) {
        return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
      }
      if (current?.state === 'IN_PROGRESS') {
        return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
      }
      if (current?.state === 'COMPLETED') {
        const replay = parseReplay(current.committedResponse)
        return replay ? json(replay, 201) : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
      }
      return errorResponse(409, 'REGISTRATION_RETRY_REQUIRED', 'The prior registration attempt is not replayable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const releaseReservation = async (): Promise<void> => {
    try {
      await env.D1
        .prepare(`DELETE FROM auth_registration_envelopes WHERE id = ? AND state = 'IN_PROGRESS'`)
        .bind(reservationId)
        .run()
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
    const diagnostic = betterAuthFailureDiagnostic(authPayload)
    console.error(JSON.stringify({
      event: 'auth.register.better_auth_rejected',
      diagnosticCode: 'AUTH001_BETTER_AUTH_REJECTED',
      upstreamStatus: authResponse.status,
      ...diagnostic,
    }))
    await releaseReservation()
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

  try {
    const payload = await getPayload({ config })
    await payload.create({
      collection: 'users',
      data: {
        identityId: userId,
        email: normalized.identity,
        username: normalized.username,
      },
      overrideAccess: true,
      disableTransaction: true,
      req: request,
    })
  } catch (error) {
    // Concurrent sign-ups can both receive a successful Better Auth response
    // before W01's unique email/username projection rejects one request. If
    // this identity is already projected, never roll back the shared identity
    // created by the winning request.
    let identityAlreadyProjected = false
    try {
      const projected = await env.D1
        .prepare('SELECT id FROM users WHERE identity_id = ? LIMIT 1')
        .bind(userId)
        .first<{ id: string }>()
      identityAlreadyProjected = !!projected
    } catch {
      // If we cannot determine whether the identity belongs to the winner,
      // fail closed without deleting a possibly shared Better Auth identity.
      await releaseReservation()
      console.error(JSON.stringify({
        event: 'auth.register.profile_projection_failure',
        diagnosticCode: 'AUTH001_PROFILE_PROJECTION_LOOKUP_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }))
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
    }

    if (identityAlreadyProjected) {
      await releaseReservation()
      console.error(JSON.stringify({
        event: 'auth.register.profile_projection_conflict',
        diagnosticCode: 'AUTH001_PROFILE_PROJECTION_CONFLICT',
        failureCategory: 'IDENTITY_ALREADY_PROJECTED',
      }))
      return errorResponse(422, 'VALIDATION_FAILED', 'Registration could not be completed')
    }

    const identityConflict =
      isUniqueConstraintError(error) ||
      (error instanceof Error && /(unique|duplicate|already exists)/i.test(error.message))
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
    console.error(JSON.stringify({
      event: identityConflict ? 'auth.register.profile_projection_conflict' : 'auth.register.profile_projection_failure',
      diagnosticCode: identityConflict ? 'AUTH001_PROFILE_PROJECTION_CONFLICT' : 'AUTH001_PROFILE_PROJECTION_FAILURE',
      failureCategory: identityConflict ? 'IDENTITY_CONFLICT' : 'PROJECTION_FAILURE',
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    return identityConflict
      ? errorResponse(422, 'VALIDATION_FAILED', 'Registration could not be completed')
      : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const committedResponseFinal = JSON.stringify({ userId, accountState: ACCOUNT_STATE })

  const statements = [
    env.D1
      .prepare(
        `INSERT INTO consents (
          id,
          actor_subject_id,
          owner_subject_id,
          resource_id,
          resource_type,
          purpose,
          state,
          policy_version,
          legal_basis,
          retention_class,
          retention_until,
          source_authority
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          'User',
          'ACCOUNT_REGISTRATION',
          'GRANTED',
          ?,
          'CONSENT',
          'LEGAL_AUDIT',
          ?,
          ?
        )`,
      )
      .bind(
        consentRecordId,
        userId,
        userId,
        userId,
        policy.policyVersion,
        policy.retentionUntil,
        policy.sourceAuthority,
      ),
    env.D1
      .prepare(
        `UPDATE auth_registration_envelopes
         SET state = 'COMPLETED',
             committed_response = ?,
             updated_at = ?
         WHERE id = ?
           AND state = 'IN_PROGRESS'`,
      )
      .bind(committedResponseFinal, now.toISOString(), reservationId),
    env.D1
      .prepare(
        `SELECT committed_response
         FROM auth_registration_envelopes
         WHERE id = ?
         LIMIT 1`,
      )
      .bind(reservationId),
  ]

  try {
    const batchResult = await env.D1.batch(statements)
    if (
      batchResult.length !== statements.length ||
      batchResult[0]?.meta?.changes !== 1 ||
      batchResult[1]?.meta?.changes !== 1 ||
      !batchResult[2]
    ) {
      throw new Error('AUTH001_BATCH_RESULT_INCOMPLETE')
    }

    const responseRow = batchResult[2]?.results?.[0] as { committed_response?: unknown } | undefined
    if (!responseRow || typeof responseRow.committed_response !== 'string') {
      throw new Error('AUTH001_COMMITTED_RESPONSE_UNAVAILABLE')
    }

    const responseBody = parseReplay(JSON.parse(responseRow.committed_response))
    if (!responseBody) {
      throw new Error('AUTH001_COMMITTED_RESPONSE_INVALID')
    }

    return json(responseBody, 201)
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
