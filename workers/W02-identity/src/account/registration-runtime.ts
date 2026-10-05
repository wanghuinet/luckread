import type { createLuckReadAuth } from '../auth/better-auth.js'

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
const ACCOUNT_STATE = 'PENDING_VERIFICATION'

type BetterAuthInstance = ReturnType<typeof createLuckReadAuth>

export type RegistrationPolicy = {
  policyVersion: string
  retentionUntil: string
  sourceAuthority: string
}

export type RegistrationInput = {
  idempotencyKey: string
  payloadHash: string
  responseDigest: string
  email: string
  password: string
  username: string
  policy: RegistrationPolicy
  now: string
}

export type RegistrationResult = {
  userId: string
  accountState: typeof ACCOUNT_STATE
}

type ExistingEnvelope = {
  id: string
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse: string | null
  expiresAt: string
  consentRecordId: string | null
}

type NativeUser = {
  id: string
  email: string
  username: string | null
  accountState: string
  accountStateVersion: number
}

export class RegistrationRuntimeError extends Error {
  constructor(
    readonly code:
      | 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
      | 'IDEMPOTENCY_IN_PROGRESS'
      | 'REGISTRATION_RETRY_REQUIRED'
      | 'REGISTRATION_CONFLICT'
      | 'SERVICE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

const isUniqueConstraintError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint|unique constraint failed|duplicate/i.test(message)
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

const parsePending = (
  value: string | null,
): { email: string; username: string } | null => {
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as { state?: unknown }).state !== 'IN_PROGRESS' ||
      typeof (parsed as { email?: unknown }).email !== 'string' ||
      typeof (parsed as { username?: unknown }).username !== 'string'
    ) {
      return null
    }

    return {
      email: (parsed as { email: string }).email,
      username: (parsed as { username: string }).username,
    }
  } catch {
    return null
  }
}

const getExistingEnvelope = async (
  db: D1Database,
  idempotencyKey: string,
): Promise<ExistingEnvelope | null> =>
  db
    .prepare(
      `SELECT id,
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
        LIMIT 1`,
    )
    .bind(idempotencyKey, SCOPE, ENDPOINT)
    .first<ExistingEnvelope>()

const getNativeUser = async (
  db: D1Database,
  email: string,
  username: string,
): Promise<NativeUser | null> =>
  db
    .prepare(
      'SELECT id, email, username, account_state AS accountState, ' +
      'account_state_version AS accountStateVersion ' +
      'FROM "user" WHERE email = ? AND username = ? LIMIT 1',
    )
    .bind(email, username)
    .first<NativeUser>()

const getNativeUserById = async (
  db: D1Database,
  userId: string,
): Promise<NativeUser | null> =>
  db
    .prepare(
      'SELECT id, email, username, account_state AS accountState, ' +
      'account_state_version AS accountStateVersion ' +
      'FROM "user" WHERE id = ? LIMIT 1',
    )
    .bind(userId)
    .first<NativeUser>()

const finalizeRegistration = async (
  db: D1Database,
  input: RegistrationInput,
  envelope: ExistingEnvelope,
  user: NativeUser,
): Promise<RegistrationResult> => {
  if (!envelope.consentRecordId) {
    throw new RegistrationRuntimeError(
      'SERVICE_UNAVAILABLE',
      'registration recovery record is unavailable',
    )
  }

  const response: RegistrationResult = {
    userId: String(user.id),
    accountState: ACCOUNT_STATE,
  }

  const result = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO consents (
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
        ) VALUES (?, ?, ?, ?, 'User', 'ACCOUNT_REGISTRATION', 'GRANTED', ?, 'CONSENT', 'LEGAL_AUDIT', ?, ?)`,
      )
      .bind(
        envelope.consentRecordId,
        user.id,
        user.id,
        user.id,
        input.policy.policyVersion,
        input.policy.retentionUntil,
        input.policy.sourceAuthority,
      ),
    db
      .prepare(
        `UPDATE auth_registration_envelopes
            SET state = 'COMPLETED',
                committed_response = ?,
                updated_at = ?
          WHERE id = ?
            AND state = 'IN_PROGRESS'`,
      )
      .bind(JSON.stringify(response), input.now, envelope.id),
    db
      .prepare(
        'SELECT committed_response FROM auth_registration_envelopes WHERE id = ? LIMIT 1',
      )
      .bind(envelope.id),
  ])

  const row = result[2]?.results?.[0] as { committed_response?: unknown } | undefined
  const replay = typeof row?.committed_response === 'string'
    ? parseReplay(row.committed_response)
    : null

  if (replay) return replay

  const current = await getExistingEnvelope(db, input.idempotencyKey)
  const currentReplay = current ? parseReplay(current.committedResponse) : null
  if (currentReplay) return currentReplay

  throw new RegistrationRuntimeError(
    'SERVICE_UNAVAILABLE',
    'registration completion was not committed',
  )
}


const markRegistrationFailed = async (db: D1Database, envelopeId: string, now: string) => {
  await db
    .prepare(
      `UPDATE auth_registration_envelopes
          SET state = 'FAILED',
              updated_at = ?
        WHERE id = ?
          AND state = 'IN_PROGRESS'`,
    )
    .bind(now, envelopeId)
    .run()
}

const reserveEnvelope = async (
  db: D1Database,
  input: RegistrationInput,
  existing: ExistingEnvelope | null,
): Promise<ExistingEnvelope> => {
  const envelopeId = crypto.randomUUID()
  const consentRecordId = crypto.randomUUID()
  const expiresAt = new Date(Date.parse(input.now) + 24 * 60 * 60 * 1000).toISOString()
  const pending = JSON.stringify({
    state: 'IN_PROGRESS',
    email: input.email,
    username: input.username,
  })

  const statements = []

  if (existing) {
    statements.push(
      db
        .prepare(
          'DELETE FROM auth_registration_envelopes ' +
          'WHERE id = ? AND active_key = ? AND expires_at <= ?',
        )
        .bind(existing.id, input.idempotencyKey, input.now),
    )
  }

  statements.push(
    db
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
        ) VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        envelopeId,
        input.idempotencyKey,
        input.idempotencyKey,
        SCOPE,
        ENDPOINT,
        input.payloadHash,
        input.responseDigest,
        pending,
        expiresAt,
        consentRecordId,
        input.now,
        input.now,
      ),
  )

  try {
    const result = await db.batch(statements)
    const insertIndex = result.length - 1
    if (result[insertIndex]?.meta?.changes !== 1) {
      throw new Error('AUTH001_REGISTRATION_RESERVATION_INCOMPLETE')
    }
  } catch (error) {
    console.error(JSON.stringify({
      event: 'auth.register.better_auth_signup_failure',
      diagnosticCode: 'AUTH001_BETTER_AUTH_SIGNUP_FAILURE',
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      errorStatus:
        typeof error === 'object' && error !== null && 'status' in error
          ? Number((error as { status?: unknown }).status)
          : null,
      errorCode:
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : null,
    }))
    if (isUniqueConstraintError(error)) {
      throw new RegistrationRuntimeError(
        'IDEMPOTENCY_IN_PROGRESS',
        'A registration with this Idempotency-Key is already in progress',
      )
    }
    throw error
  }

  // Read back by the newly generated primary key rather than the idempotency-key index.
  // This makes the post-reservation invariant independent of secondary-index visibility.
  const reserved = await db
    .prepare(
      `SELECT id,
              payload_hash AS payloadHash,
              state,
              committed_response AS committedResponse,
              expires_at AS expiresAt,
              consent_record_id AS consentRecordId
         FROM auth_registration_envelopes
        WHERE id = ?
        LIMIT 1`,
    )
    .bind(envelopeId)
    .first<ExistingEnvelope>()

  if (
    !reserved ||
    reserved.payloadHash !== input.payloadHash ||
    reserved.state !== 'IN_PROGRESS' ||
    !reserved.consentRecordId
  ) {
    console.error(JSON.stringify({
      event: 'auth.register.registration_reservation_missing',
      diagnosticCode: 'AUTH001_REGISTRATION_RESERVATION_MISSING',
      reservationId: envelopeId,
      observedState: reserved?.state ?? null,
      hasConsentRecordId: Boolean(reserved?.consentRecordId),
    }))
    throw new RegistrationRuntimeError(
      'SERVICE_UNAVAILABLE',
      'registration reservation is unavailable',
    )
  }

  console.error(JSON.stringify({
    event: 'auth.register.registration_reservation_reserved',
    diagnosticCode: 'AUTH001_REGISTRATION_RESERVATION_RESERVED',
    reservationId: reserved.id,
    state: reserved.state,
  }))

  return reserved
}

export async function registerWithBetterAuth(
  db: D1Database,
  auth: BetterAuthInstance,
  input: RegistrationInput,
): Promise<RegistrationResult> {
  const existing = await getExistingEnvelope(db, input.idempotencyKey)

  if (existing && Date.parse(existing.expiresAt) > Date.parse(input.now)) {
    if (existing.payloadHash !== input.payloadHash) {
      throw new RegistrationRuntimeError(
        'IDEMPOTENCY_KEY_REUSE_CONFLICT',
        'Idempotency key cannot be reused with different input',
      )
    }

    if (existing.state === 'COMPLETED') {
      const replay = parseReplay(existing.committedResponse)
      if (!replay) {
        throw new RegistrationRuntimeError(
          'SERVICE_UNAVAILABLE',
          'registration replay record is unavailable',
        )
      }

      const nativeUser = await getNativeUserById(db, replay.userId)
      if (!nativeUser) {
        throw new RegistrationRuntimeError(
          'SERVICE_UNAVAILABLE',
          'registration replay is not backed by Better Auth',
        )
      }

      return replay
    }

    if (existing.state === 'IN_PROGRESS') {
      const pending = parsePending(existing.committedResponse)
      if (pending && pending.email === input.email && pending.username === input.username) {
        const nativeUser = await getNativeUser(db, pending.email, pending.username)
        if (nativeUser) {
          return finalizeRegistration(db, input, existing, nativeUser)
        }
      }

      throw new RegistrationRuntimeError(
        'IDEMPOTENCY_IN_PROGRESS',
        'A registration with this Idempotency-Key is already in progress',
      )
    }

    throw new RegistrationRuntimeError(
      'REGISTRATION_RETRY_REQUIRED',
      'The prior registration attempt is not replayable',
    )
  }

  const envelope = await reserveEnvelope(db, input, existing)

  let nativeUser: NativeUser

  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.username,
        username: input.username,
      },
    })

    nativeUser = {
      id: String(result.user.id),
      email: String(result.user.email),
      username: result.user.username ? String(result.user.username) : null,
      accountState: result.user.accountState
        ? String(result.user.accountState)
        : ACCOUNT_STATE,
      accountStateVersion: Number(result.user.accountStateVersion ?? 1),
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await markRegistrationFailed(db, envelope.id, input.now)
      throw new RegistrationRuntimeError(
        'REGISTRATION_CONFLICT',
        'Registration could not be completed',
      )
    }

    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 0

    if (status === 400 || status === 422) {
      await markRegistrationFailed(db, envelope.id, input.now)
      throw new RegistrationRuntimeError(
        'REGISTRATION_CONFLICT',
        'Registration could not be completed',
      )
    }

    const recoveredUser = await getNativeUser(db, input.email, input.username)
    if (!recoveredUser) {
      await markRegistrationFailed(db, envelope.id, input.now)
    }

    throw new RegistrationRuntimeError(
      'SERVICE_UNAVAILABLE',
      'Registration service unavailable',
    )
  }

  return finalizeRegistration(db, input, envelope, nativeUser)
}
