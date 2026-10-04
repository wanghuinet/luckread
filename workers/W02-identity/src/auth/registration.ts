import { getBetterAuth, type BetterAuthEnv } from './better-auth.js'
import priv004DevPolicy from '../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'
import priv004ProdPolicy from '../../../../../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
const ACCOUNT_STATE = 'PENDING_VERIFICATION'
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export type RegistrationEnv = BetterAuthEnv & { CLOUDFLARE_ENV?: string }

type D1PreparedStatementLike = {
  bind: (...args: unknown[]) => D1PreparedStatementLike
  first: <T>() => Promise<T | null>
  run: () => Promise<{ meta?: { changes?: number } }>
}

type D1DatabaseLike = {
  prepare: (sql: string) => D1PreparedStatementLike
  batch: (statements: D1PreparedStatementLike[]) => Promise<Array<{ meta?: { changes?: number } }>>
}

type RegistrationResponse = {
  userId: string
  accountState: typeof ACCOUNT_STATE
}

type ExistingEnvelope = {
  id: string
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse?: string | null
  expiresAt: string
  consentRecordId?: string | null
}

const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })

const errorResponse = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) =>
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

const isExpired = (expiresAt: string, now: Date) => {
  const value = Date.parse(expiresAt)
  return !Number.isFinite(value) || value <= now.getTime()
}

const getExistingEnvelope = async (
  db: D1DatabaseLike,
  idempotencyKey: string,
): Promise<ExistingEnvelope | null> =>
  db
    .prepare(
      `
        SELECT id,
               payload_hash AS payloadHash,
               state,
               committed_response AS committedResponse,
               expires_at AS expiresAt,
               consent_record_id AS consentRecordId
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

const parseReplay = (
  value: ExistingEnvelope['committedResponse'],
): RegistrationResponse | null => {
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
  ) return null

  return {
    userId: (parsed as { userId: string }).userId,
    accountState: ACCOUNT_STATE,
  }
}

const isUniqueConstraintError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint|unique constraint failed|duplicate/i.test(message)
}

const validatePolicy = (now: Date, runtimeEnvironment: string) => {
  const priv004Policy =
    runtimeEnvironment.toLowerCase() === 'production'
      ? priv004ProdPolicy
      : priv004DevPolicy

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
  ) {
    throw new Error('PRIV004_POLICY_NOT_ADMISSIBLE')
  }

  const effectiveFrom = Date.parse(priv004Policy.effectiveFrom)
  const effectiveTo =
    priv004Policy.effectiveTo === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(priv004Policy.effectiveTo)

  if (
    !Number.isFinite(effectiveFrom) ||
    (!Number.isFinite(effectiveTo) && effectiveTo !== Number.POSITIVE_INFINITY) ||
    now.getTime() < effectiveFrom ||
    now.getTime() > effectiveTo
  ) {
    throw new Error('PRIV004_POLICY_OUTSIDE_WINDOW')
  }

  return {
    policyVersion: priv004Policy.policyVersion,
    retentionClass: 'LEGAL_AUDIT' as const,
    retentionUntil: new Date(
      now.getTime() + priv004Policy.rule.durationSeconds * 1000,
    ).toISOString(),
    sourceAuthority: priv004Policy.sourceAuthority,
  }
}

const findUser = async (
  db: D1DatabaseLike,
  email: string,
  username: string,
): Promise<{ id: string; accountState: string | null } | null> =>
  db
    .prepare(
      `SELECT CAST(id AS TEXT) AS id, account_state AS accountState
       FROM users
       WHERE email = ? AND username = ?
       LIMIT 1`,
    )
    .bind(email, username)
    .first<{ id: string; accountState: string | null }>()

const hasConsent = async (db: D1DatabaseLike, userId: string, policyVersion: string) =>
  Boolean(
    (
      await db
        .prepare(
          `SELECT id FROM consents
           WHERE resource_id = ?
             AND purpose = ?
             AND state = 'GRANTED'
             AND policy_version = ?
           LIMIT 1`,
        )
        .bind(userId, SCOPE, policyVersion)
        .first<{ id: string }>()
    )?.id,
  )

const completeEnvelope = async (
  db: D1DatabaseLike,
  envelopeId: string,
  userId: string,
  consentRecordId: string,
  policy: ReturnType<typeof validatePolicy>,
  payloadHash: string,
  idempotencyKey: string,
  createdAt: string,
  expiresAt: string,
): Promise<RegistrationResponse> => {
  const responseBody: RegistrationResponse = {
    userId,
    accountState: ACCOUNT_STATE,
  }
  const committedResponse = JSON.stringify(responseBody)
  const responseDigest = await sha256Hex(
    JSON.stringify(
      canonicalize({
        schema: 'AUTH-001.response-digest.v1',
        operationId: ENDPOINT,
        endpoint: '/auth/register',
        idempotencyKey,
        payloadHash,
        status: 201,
        accountState: ACCOUNT_STATE,
      }),
    ),
  )

  const existingConsent = await hasConsent(db, userId, policy.policyVersion)
  const statements: D1PreparedStatementLike[] = []

  if (!existingConsent) {
    statements.push(
      db
        .prepare(
          `INSERT INTO consents (
             id, actor_subject_id, owner_subject_id, resource_id, resource_type,
             purpose, state, policy_version, legal_basis, retention_class,
             retention_until, source_authority
           ) VALUES (?, ?, ?, ?, 'User', ?, 'GRANTED', ?, 'CONSENT', ?, ?, ?)`,
        )
        .bind(
          consentRecordId,
          userId,
          userId,
          userId,
          SCOPE,
          policy.policyVersion,
          policy.retentionClass,
          policy.retentionUntil,
          policy.sourceAuthority,
        ),
    )
  }

  statements.push(
    db
      .prepare(
        `UPDATE auth_registration_envelopes
         SET state = 'COMPLETED',
             committed_response = ?,
             response_digest = ?,
             consent_record_id = ?,
             expires_at = ?,
             updated_at = ?
         WHERE id = ? AND state = 'IN_PROGRESS'`,
      )
      .bind(
        committedResponse,
        responseDigest,
        consentRecordId,
        expiresAt,
        createdAt,
        envelopeId,
      ),
  )

  const results = await db.batch(statements)
  const completionIndex = statements.length - 1
  const consentExpectedChange = existingConsent ? 0 : 1
  const consentOk = existingConsent
    ? true
    : results[0]?.meta?.changes === consentExpectedChange

  if (!consentOk || results[completionIndex]?.meta?.changes !== 1) {
    throw new Error('AUTH001_REGISTRATION_COMPLETION_FAILED')
  }

  return responseBody
}

export async function registerWithBetterAuth(request: Request, env: RegistrationEnv): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (!isRecord(body) || !isRecord(body.consent)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const identity = body.identity
  const credential = body.credential
  const username = body.username
  const consent = body.consent

  if (
    body.identityType !== 'email' ||
    typeof identity !== 'string' ||
    identity.trim().length === 0 ||
    typeof credential !== 'string' ||
    credential.length === 0 ||
    typeof username !== 'string' ||
    username.trim().length === 0 ||
    username.length > 128 ||
    consent.purpose !== SCOPE ||
    typeof consent.policyVersion !== 'string' ||
    consent.policyVersion.length === 0 ||
    Object.keys(consent).some((key) => !['purpose', 'policyVersion'].includes(key))
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const now = new Date()
  let policy: ReturnType<typeof validatePolicy>
  try {
    policy = validatePolicy(now, env.CLOUDFLARE_ENV ?? 'development')
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration policy is unavailable')
  }

  if (consent.policyVersion !== policy.policyVersion) {
    return errorResponse(
      422,
      'VALIDATION_FAILED',
      'Consent policyVersion is not admitted for registration',
    )
  }

  const normalized = {
    identityType: 'email',
    identity: identity.trim().toLowerCase(),
    credential,
    username: username.trim(),
    consent: { purpose: SCOPE, policyVersion: consent.policyVersion },
  }

  const payloadHash = await sha256Hex(
    JSON.stringify(canonicalize(normalized)),
  )
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  const existing = await getExistingEnvelope(env.D1_01, idempotencyKey)

  if (existing && !isExpired(existing.expiresAt, now)) {
    if (existing.payloadHash !== payloadHash) {
      return errorResponse(
        422,
        'IDEMPOTENCY_KEY_REUSE_CONFLICT',
        'Idempotency key cannot be reused with different input',
      )
    }

    if (existing.state === 'COMPLETED') {
      const replay = parseReplay(existing.committedResponse)
      return replay
        ? json(replay, 201)
        : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
    }

    if (existing.state === 'IN_PROGRESS') {
      const recovered = await findUser(
        env.D1_01,
        normalized.identity,
        normalized.username,
      )

      if (recovered?.id) {
        try {
          const response = await completeEnvelope(
            env.D1_01,
            existing.id,
            recovered.id,
            existing.consentRecordId || crypto.randomUUID(),
            policy,
            payloadHash,
            idempotencyKey,
            now.toISOString(),
            existing.expiresAt,
          )
          return json(response, 201)
        } catch (error) {
          console.error(
            JSON.stringify({
              event: 'auth.register.recovery_failure',
              diagnosticCode: 'AUTH001_BETTER_AUTH_REGISTRATION_RECOVERY_FAILURE',
              errorName: error instanceof Error ? error.name : typeof error,
            }),
          )
          return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration recovery is unavailable')
        }
      }

      return errorResponse(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'A registration with this Idempotency-Key is already in progress',
        { 'retry-after': '1' },
      )
    }

    return errorResponse(
      409,
      'REGISTRATION_RETRY_REQUIRED',
      'The prior registration attempt is not replayable',
    )
  }

  const envelopeId = crypto.randomUUID()
  const consentRecordId = crypto.randomUUID()

  try {
    await env.D1_01.prepare(
      `INSERT INTO auth_registration_envelopes (
         id, idempotency_key, active_key, scope, endpoint, payload_hash,
         state, response_digest, committed_response, expires_at,
         consent_record_id, updated_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, NULL, ?, ?, ?, ?)`,
    ).bind(
      envelopeId,
      idempotencyKey,
      idempotencyKey,
      SCOPE,
      ENDPOINT,
      payloadHash,
      expiresAt,
      consentRecordId,
      now.toISOString(),
      now.toISOString(),
    ).run()
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return errorResponse(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'A registration with this Idempotency-Key is already in progress',
        { 'retry-after': '1' },
      )
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const auth = getBetterAuth(env)

  try {
    const result = await auth.api.signUpEmail({
      headers: request.headers,
      body: {
        name: normalized.username,
        email: normalized.identity,
        password: normalized.credential,
        displayName: normalized.username,
        callbackURL: (() => { const origin = request.headers.get('x-luckread-public-origin')?.trim(); if (origin && /^https:\/\/([a-z0-9-]+\.)*luckread\.com$/i.test(origin)) return new URL('/login', origin).toString(); return 'https://luckread.com/login' })(),
        rememberMe: false,
      },
    })

    const userId = String(result.user.id)
    const response = await completeEnvelope(
      env.D1_01,
      envelopeId,
      userId,
      consentRecordId,
      policy,
      payloadHash,
      idempotencyKey,
      now.toISOString(),
      expiresAt,
    )

    return json(response, 201)
  } catch (error) {
    const existingUser = await findUser(
      env.D1_01,
      normalized.identity,
      normalized.username,
    ).catch((): null => null)

    if (existingUser?.id) {
      try {
        const response = await completeEnvelope(
          env.D1_01,
          envelopeId,
          existingUser.id,
          consentRecordId,
          policy,
          payloadHash,
          idempotencyKey,
          now.toISOString(),
          expiresAt,
        )
        return json(response, 201)
      } catch {
        // Fall through to canonical registration failure.
      }
    }

    try {
      await env.D1_01
        .prepare(
          `UPDATE auth_registration_envelopes
           SET state = 'FAILED', updated_at = ?
           WHERE id = ? AND state = 'IN_PROGRESS'`,
        )
        .bind(now.toISOString(), envelopeId)
        .run()
    } catch {
      // Preserve the original auth failure response and fail closed.
    }

    const message = error instanceof Error ? error.message : String(error)
    if (/already exists|already registered|unique constraint|duplicate/i.test(message)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Registration could not be completed')
    }

    console.error(
      JSON.stringify({
        event: 'auth.register.better_auth_failure',
        diagnosticCode: 'AUTH001_BETTER_AUTH_REGISTRATION_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )

    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }
}
