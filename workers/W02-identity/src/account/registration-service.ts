import priv004DevPolicy from '../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'
import priv004ProdPolicy from '../../../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'
import { createLuckReadAuth } from '../auth/better-auth.js'

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
const ACCOUNT_STATE = 'PENDING_VERIFICATION' as const
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

export type RegistrationInput = {
  identityType: unknown
  identity: unknown
  credential: unknown
  username: unknown
  consent: unknown
}

export type RegistrationResult = {
  userId: string
  accountState: typeof ACCOUNT_STATE
}

type ExistingEnvelope = {
  id: string
  idempotencyKey: string
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse: string | null
  expiresAt: string
  createdAt: string
  consentRecordId: string | null
}

type RegistrationPolicy = {
  policyVersion: string
  retentionUntil: string
  sourceAuthority: string
}

type DatabaseEnv = {
  D1_01: D1Database
}

export class RegistrationServiceError extends Error {
  constructor(
    readonly code:
      | 'VALIDATION_FAILED'
      | 'IDEMPOTENCY_KEY_REQUIRED'
      | 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
      | 'IDEMPOTENCY_IN_PROGRESS'
      | 'REGISTRATION_RETRY_REQUIRED'
      | 'SERVICE_UNAVAILABLE',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

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

const isExpired = (value: string, now: Date): boolean => {
  const timestamp = Date.parse(value)
  return !Number.isFinite(timestamp) || timestamp <= now.getTime()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isUniqueConstraintError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint|unique constraint failed|duplicate/i.test(message)
}

const resolveRegistrationPolicy = (now: Date): RegistrationPolicy => {
  const environment =
    process.env.CLOUDFLARE_ENV ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  const production = environment.toLowerCase() === 'production'
  const policy = production ? priv004ProdPolicy : priv004DevPolicy

  if (
    policy.status !== 'APPROVED' ||
    (production
      ? policy.environment !== 'PRODUCTION' || policy.usage.productionUse !== true
      : policy.environment !== 'DEVELOPMENT' || policy.usage.productionUse !== false) ||
    policy.rule.mode !== 'DURATION' ||
    !Number.isSafeInteger(policy.rule.durationSeconds) ||
    policy.rule.durationSeconds <= 0 ||
    policy.scope.operationId !== ENDPOINT ||
    policy.scope.purpose !== SCOPE
  ) {
    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration policy is unavailable',
      503,
    )
  }

  const effectiveFrom = Date.parse(policy.effectiveFrom)
  const effectiveTo =
    policy.effectiveTo === null ? Number.POSITIVE_INFINITY : Date.parse(policy.effectiveTo)

  if (
    !Number.isFinite(effectiveFrom) ||
    (!Number.isFinite(effectiveTo) && effectiveTo !== Number.POSITIVE_INFINITY) ||
    now.getTime() < effectiveFrom ||
    now.getTime() > effectiveTo
  ) {
    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration policy is unavailable',
      503,
    )
  }

  return {
    policyVersion: policy.policyVersion,
    retentionUntil: new Date(
      now.getTime() + policy.rule.durationSeconds * 1000,
    ).toISOString(),
    sourceAuthority: policy.sourceAuthority,
  }
}

const parseRegistrationInput = (
  body: RegistrationInput,
  policy: RegistrationPolicy,
): {
  email: string
  password: string
  username: string
  payloadHash: string
  responseDigest: string
} => {
  if (!isRecord(body.consent)) {
    throw new RegistrationServiceError('VALIDATION_FAILED', 'Invalid registration request', 422)
  }

  if (
    body.identityType !== 'email' ||
    typeof body.identity !== 'string' ||
    body.identity.trim().length === 0 ||
    typeof body.credential !== 'string' ||
    body.credential.length === 0 ||
    typeof body.username !== 'string' ||
    body.username.trim().length === 0 ||
    body.username.length > 128 ||
    body.consent.purpose !== SCOPE ||
    body.consent.policyVersion !== policy.policyVersion ||
    Object.keys(body.consent).some(
      (key) => !['purpose', 'policyVersion'].includes(key),
    )
  ) {
    throw new RegistrationServiceError('VALIDATION_FAILED', 'Invalid registration request', 422)
  }

  const email = body.identity.trim().toLowerCase()
  const username = body.username.trim()
  return {
    email,
    password: body.credential,
    username,
    payloadHash: '',
    responseDigest: '',
  }
}

const parseReplay = (value: string | null): RegistrationResult | null => {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
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
  } catch {
    return null
  }
}

const readEnvelope = async (
  db: D1Database,
  idempotencyKey: string,
): Promise<ExistingEnvelope | null> =>
  db
    .prepare(
      `
        SELECT
          id,
          idempotency_key AS idempotencyKey,
          payload_hash AS payloadHash,
          state,
          committed_response AS committedResponse,
          expires_at AS expiresAt,
          created_at AS createdAt,
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

const readUserByEmail = async (
  db: D1Database,
  email: string,
): Promise<{ id: string; accountState: string; createdAt: string; username: string } | null> =>
  db
    .prepare(
      'SELECT CAST(id AS TEXT) AS id, account_state AS accountState, created_at AS createdAt, username FROM "user" WHERE email = ? LIMIT 1',
    )
    .bind(email)
    .first<{ id: string; accountState: string; createdAt: string; username: string }>()

const finalizeRegistration = async (
  db: D1Database,
  envelope: ExistingEnvelope,
  userId: string,
  policy: RegistrationPolicy,
  now: Date,
): Promise<RegistrationResult> => {
  const result: RegistrationResult = {
    userId,
    accountState: ACCOUNT_STATE,
  }
  const committedResponse = JSON.stringify(result)

  const existingConsent = envelope.consentRecordId
  const consentRecordId = existingConsent ?? crypto.randomUUID()

  try {
    const statements = [
      db
        .prepare(
          `
            INSERT OR IGNORE INTO consents (
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
            VALUES (?, ?, ?, ?, 'User', ?, 'GRANTED', ?, 'CONSENT', 'LEGAL_AUDIT', ?, ?)
          `,
        )
        .bind(
          consentRecordId,
          userId,
          userId,
          userId,
          SCOPE,
          policy.policyVersion,
          policy.retentionUntil,
          policy.sourceAuthority,
        ),
      db
        .prepare(
          `
            UPDATE auth_registration_envelopes
               SET state = 'COMPLETED',
                   committed_response = ?,
                   consent_record_id = ?,
                   updated_at = ?
             WHERE id = ?
               AND state = 'IN_PROGRESS'
          `,
        )
        .bind(
          committedResponse,
          consentRecordId,
          now.toISOString(),
          envelope.id,
        ),
    ]

    const batch = await db.batch(statements)
    if (batch[1]?.meta?.changes !== 1) {
      const reread = await readEnvelope(db, envelope.idempotencyKey)
      const replay = reread?.state === 'COMPLETED' ? parseReplay(reread.committedResponse) : null
      if (replay) return replay
      throw new Error('AUTH001_REGISTRATION_FINALIZATION_CONFLICT')
    }

    return result
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const reread = await db.prepare(
        `
          SELECT id, idempotency_key AS idempotencyKey, payload_hash AS payloadHash, state,
                 committed_response AS committedResponse, expires_at AS expiresAt,
                 created_at AS createdAt, consent_record_id AS consentRecordId
          FROM auth_registration_envelopes
          WHERE id = ?
          LIMIT 1
        `,
      ).bind(envelope.id).first<ExistingEnvelope>()

      const replay = reread?.state === 'COMPLETED' ? parseReplay(reread.committedResponse) : null
      if (replay) return replay
    }

    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration persistence is unavailable',
      503,
    )
  }
}

const reserveRegistration = async (
  db: D1Database,
  idempotencyKey: string,
  payloadHash: string,
  responseDigest: string,
  now: Date,
): Promise<{ envelope: ExistingEnvelope; fresh: boolean }> => {
  const current = await readEnvelope(db, idempotencyKey)
  if (current && !isExpired(current.expiresAt, now)) {
    if (current.payloadHash !== payloadHash) {
      throw new RegistrationServiceError(
        'IDEMPOTENCY_KEY_REUSE_CONFLICT',
        'Idempotency key cannot be reused with different input',
        422,
      )
    }

    return { envelope: current, fresh: false }
  }

  const envelopeId = crypto.randomUUID()
  const consentRecordId = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()

  const cleanup =
    current && isExpired(current.expiresAt, now)
      ? db
          .prepare(
            'DELETE FROM auth_registration_envelopes WHERE id = ? AND active_key = ? AND expires_at <= ?',
          )
          .bind(current.id, idempotencyKey, now.toISOString())
      : null

  const statements = []
  if (cleanup) statements.push(cleanup)

  statements.push(
    db
      .prepare(
        `
          INSERT INTO auth_registration_envelopes (
            id, idempotency_key, active_key, scope, endpoint, payload_hash,
            state, response_digest, committed_response, expires_at,
            consent_record_id, updated_at, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, NULL, ?, ?, ?, ?)
        `,
      )
      .bind(
        envelopeId,
        idempotencyKey,
        idempotencyKey,
        SCOPE,
        ENDPOINT,
        payloadHash,
        responseDigest,
        expiresAt,
        consentRecordId,
        now.toISOString(),
        now.toISOString(),
      ),
  )

  try {
    const batch = await db.batch(statements)
    const insertIndex = cleanup ? 1 : 0
    if (batch[insertIndex]?.meta?.changes !== 1) {
      throw new Error('AUTH001_REGISTRATION_RESERVATION_NOT_APPLIED')
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const winner = await readEnvelope(db, idempotencyKey)
      if (winner) return { envelope: winner, fresh: false }
    }
    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration persistence is unavailable',
      503,
    )
  }

  const reserved = await readEnvelope(db, idempotencyKey)
  if (!reserved) {
    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration persistence is unavailable',
      503,
    )
  }
  return { envelope: reserved, fresh: true }
}

export async function registerWithBetterAuth(
  env: DatabaseEnv,
  input: RegistrationInput,
  idempotencyKey: string,
  now = new Date(),
): Promise<RegistrationResult> {
  if (
    typeof idempotencyKey !== 'string' ||
    idempotencyKey.trim().length === 0 ||
    idempotencyKey.length > 255
  ) {
    throw new RegistrationServiceError(
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
      400,
    )
  }

  const policy = resolveRegistrationPolicy(now)
  const parsed = parseRegistrationInput(input, policy)
  const normalized = {
    identityType: 'email',
    identity: parsed.email,
    credential: parsed.password,
    username: parsed.username,
    consent: {
      purpose: SCOPE,
      policyVersion: policy.policyVersion,
    },
  }

  parsed.payloadHash = await sha256Hex(JSON.stringify(canonicalize(normalized)))
  parsed.responseDigest = await sha256Hex(
    JSON.stringify(
      canonicalize({
        schema: 'AUTH-001.response-digest.v1',
        operationId: ENDPOINT,
        endpoint: '/auth/register',
        idempotencyKey,
        payloadHash: parsed.payloadHash,
        status: 201,
        accountState: ACCOUNT_STATE,
      }),
    ),
  )

  const reservation = await reserveRegistration(
    env.D1_01,
    idempotencyKey,
    parsed.payloadHash,
    parsed.responseDigest,
    now,
  )
  const envelope = reservation.envelope

  if (envelope.state === 'COMPLETED') {
    const replay = parseReplay(envelope.committedResponse)
    if (replay) return replay
    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration replay record is unavailable',
      503,
    )
  }

  if (envelope.state !== 'IN_PROGRESS') {
    throw new RegistrationServiceError(
      'REGISTRATION_RETRY_REQUIRED',
      'The prior registration attempt is not replayable',
      409,
    )
  }

  if (!reservation.fresh) {
    const knownUser = await readUserByEmail(env.D1_01, parsed.email)
    if (
      knownUser &&
      knownUser.username === parsed.username &&
      Date.parse(knownUser.createdAt) >= Date.parse(envelope.createdAt)
    ) {
      if (
        knownUser.accountState !== ACCOUNT_STATE &&
        knownUser.accountState !== 'ACTIVE'
      ) {
        throw new RegistrationServiceError(
          'REGISTRATION_RETRY_REQUIRED',
          'The registration is not in a replayable state',
          409,
        )
      }

      return finalizeRegistration(env.D1_01, envelope, knownUser.id, policy, now)
    }

    throw new RegistrationServiceError(
      'IDEMPOTENCY_IN_PROGRESS',
      'A registration with this Idempotency-Key is already in progress',
      409,
    )
  }

  const auth = createLuckReadAuth({ D1_01: env.D1_01 })

  let createdUserId: string
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: parsed.email,
        password: parsed.password,
        name: parsed.username,
        username: parsed.username,
      },
    })

    if (!result?.user?.id) {
      throw new Error('BETTER_AUTH_SIGNUP_MISSING_USER_ID')
    }

    createdUserId = String(result.user.id)
  } catch (error) {
    const status =
      error &&
      typeof error === 'object' &&
      'status' in error &&
      typeof (error as { status?: unknown }).status === 'number'
        ? Number((error as { status: number }).status)
        : 0

    if (status === 400 || status === 422 || isUniqueConstraintError(error)) {
      throw new RegistrationServiceError(
        'VALIDATION_FAILED',
        'Registration could not be completed',
        422,
      )
    }

    console.error(
      JSON.stringify({
        event: 'auth.register.better_auth_failure',
        diagnosticCode: 'AUTH001_BETTER_AUTH_SIGNUP_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )

    throw new RegistrationServiceError(
      'SERVICE_UNAVAILABLE',
      'Registration service unavailable',
      503,
    )
  }

  return finalizeRegistration(env.D1_01, envelope, createdUserId, policy, now)
}
