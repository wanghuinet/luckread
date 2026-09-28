import {
  addCredential,
  normalizeCredentialValue,
  type CredentialKind,
} from '../credentials/credential-add.js'
import {
  resolveCredentialHashKeySet,
  type CredentialHashSecretEnv,
} from '../credentials/credential-hash-key.js'

const MATERIALIZATION_SCOPE = 'ACCOUNT_REGISTRATION'
const MATERIALIZATION_ENDPOINT = 'authRegister'
const NORMALIZATION_VERSION = 'AUTH-003-NORM-V1'
const MAX_ENVELOPES_PER_RUN = 10

type RegistrationEnvelopeCandidate = {
  id: string
  idempotency_key: string
  committed_response: string
  created_at: string
  user_id: string
  email: string
  username: string
  identity_id: string | null
}

type UserRow = {
  id: string | number
  email: string
  username: string
}

type IdentityRow = {
  id: string
  user_id: string
  username: string | null
  username_normalized: string | null
  email: string | null
  email_normalized: string | null
  normalization_version: string
}

type CredentialRow = {
  id: string
  kind: CredentialKind
  normalized_value: string
  active: number
}

export type RegistrationMaterializationReport = {
  scanned: number
  materialized: number
  alreadyConverged: number
  failed: Array<{
    envelopeId: string
    code: string
  }>
}

export function parseCommittedRegistrationUserId(value: unknown): string | null {
  if (typeof value !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as { userId?: unknown }).userId !== 'string' ||
      (parsed as { userId?: string }).userId.trim().length === 0
    ) {
      return null
    }

    return String((parsed as { userId: string }).userId)
  } catch {
    return null
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function deriveMaterializedIdentityId(userId: string): Promise<string> {
  const digest = await sha256Hex('luckread-auth001\0identity\0' + userId)
  return 'auth1_' + digest
}

async function deriveMaterializedCredentialIdempotencyKey(
  registrationKey: string,
  kind: CredentialKind,
): Promise<string> {
  const digest = await sha256Hex(
    'luckread-auth001\0materialized-credential\0' + registrationKey + '\0' + kind,
  )
  return 'auth1m_' + digest
}

async function getPendingRegistrationEnvelopes(
  db: D1Database,
  now: string,
): Promise<RegistrationEnvelopeCandidate[]> {
  const result = await db
    .prepare(
      'SELECT e.id, e.idempotency_key, e.committed_response, e.created_at, ' +
      'CAST(u.id AS TEXT) AS user_id, u.email, u.username, i.id AS identity_id ' +
      'FROM auth_registration_envelopes e ' +
      'INNER JOIN users u ' +
      '  ON CAST(u.id AS TEXT) = CAST(json_extract(e.committed_response, \'$.userId\') AS TEXT) ' +
      'LEFT JOIN auth_identities i ON i.user_id = CAST(u.id AS TEXT) ' +
      'LEFT JOIN auth_credentials ce ' +
      '  ON ce.identity_id = i.id AND ce.kind = \'email\' AND ce.active = 1 ' +
      'LEFT JOIN auth_credentials cu ' +
      '  ON cu.identity_id = i.id AND cu.kind = \'username\' AND cu.active = 1 ' +
      'WHERE e.state = \'COMPLETED\' ' +
      '  AND e.scope = ? ' +
      '  AND e.endpoint = ? ' +
      '  AND e.expires_at > ? ' +
      '  AND (i.id IS NULL OR ce.id IS NULL OR cu.id IS NULL) ' +
      'ORDER BY e.created_at ASC ' +
      'LIMIT ' + MAX_ENVELOPES_PER_RUN,
    )
    .bind(MATERIALIZATION_SCOPE, MATERIALIZATION_ENDPOINT, now)
    .all<RegistrationEnvelopeCandidate>()

  return result.results ?? []
}

async function getIdentity(db: D1Database, userId: string): Promise<IdentityRow | null> {
  const row = await db
    .prepare(
      'SELECT id, user_id, username, username_normalized, email, ' +
      'email_normalized, normalization_version ' +
      'FROM auth_identities WHERE user_id = ? LIMIT 1',
    )
    .bind(userId)
    .first<IdentityRow>()

  return row ?? null
}

async function ensureIdentity(
  db: D1Database,
  user: UserRow,
): Promise<{ identity: IdentityRow; created: boolean }> {
  const userId = String(user.id)
  const usernameNormalized = normalizeCredentialValue('username', user.username)
  const emailNormalized = normalizeCredentialValue('email', user.email)
  const identityId = await deriveMaterializedIdentityId(userId)

  const before = await getIdentity(db, userId)

  if (!before) {
    await db
      .prepare(
        'INSERT OR IGNORE INTO auth_identities (' +
        'id, user_id, username, username_normalized, email, email_normalized, ' +
        'phone, phone_normalized, normalization_version' +
        ') VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)',
      )
      .bind(
        identityId,
        userId,
        user.username,
        usernameNormalized,
        user.email,
        emailNormalized,
        NORMALIZATION_VERSION,
      )
      .run()
  }

  const identity = await getIdentity(db, userId)
  if (!identity) throw new Error('AUTH001_IDENTITY_MATERIALIZATION_MISSING_IDENTITY')

  if (
    identity.username !== user.username ||
    identity.username_normalized !== usernameNormalized ||
    identity.email !== user.email ||
    identity.email_normalized !== emailNormalized ||
    identity.normalization_version !== NORMALIZATION_VERSION
  ) {
    throw new Error('AUTH001_IDENTITY_MATERIALIZATION_SOURCE_CONFLICT')
  }

  return {
    identity,
    created: !before,
  }
}

async function getCredentialKinds(
  db: D1Database,
  identityId: string,
): Promise<Map<CredentialKind, CredentialRow>> {
  const result = await db
    .prepare(
      'SELECT id, kind, normalized_value, active ' +
      'FROM auth_credentials ' +
      'WHERE identity_id = ? AND kind IN (\'email\', \'username\')',
    )
    .bind(identityId)
    .all<CredentialRow>()

  return new Map((result.results ?? []).map((row) => [row.kind, row]))
}

async function ensureCredential(
  db: D1Database,
  identityId: string,
  userId: string,
  registrationKey: string,
  kind: CredentialKind,
  value: string,
  secret: string,
): Promise<boolean> {
  const normalizedValue = normalizeCredentialValue(kind, value)
  const credentials = await getCredentialKinds(db, identityId)
  const existing = credentials.get(kind)

  if (existing) {
    if (existing.active !== 1 || existing.normalized_value !== normalizedValue) {
      throw new Error('AUTH001_CREDENTIAL_MATERIALIZATION_SOURCE_CONFLICT')
    }
    return false
  }

  const idempotencyKey = await deriveMaterializedCredentialIdempotencyKey(registrationKey, kind)

  await addCredential(db, {
    actorUserId: userId,
    targetUserId: userId,
    kind,
    value,
    idempotencyKey,
    secret,
    now: new Date().toISOString(),
  })

  return true
}

export async function reconcileCompletedRegistrationMaterialization(
  db: D1Database,
  env: CredentialHashSecretEnv,
  now = new Date().toISOString(),
): Promise<RegistrationMaterializationReport> {
  const keys = resolveCredentialHashKeySet(env)
  const envelopes = await getCompletedRegistrationEnvelopes(db, now)
  const report: RegistrationMaterializationReport = {
    scanned: envelopes.length,
    materialized: 0,
    alreadyConverged: 0,
    failed: [],
  }

  for (const envelope of envelopes) {
    try {
      const userId = parseCommittedRegistrationUserId(envelope.committed_response)
      if (!userId) throw new Error('AUTH001_MATERIALIZATION_COMMITTED_RESPONSE_INVALID')

      const candidate = envelopes.find((entry) => entry.id === envelope.id)
      if (!candidate || candidate.user_id !== userId) {
        throw new Error('AUTH001_MATERIALIZATION_USER_NOT_FOUND')
      }

      const user: UserRow = {
        id: candidate.user_id,
        email: candidate.email,
        username: candidate.username,
      }

      const { identity, created } = await ensureIdentity(db, user)

      const emailCreated = await ensureCredential(
        db,
        identity.id,
        userId,
        envelope.idempotency_key,
        'email',
        user.email,
        keys.active,
      )

      const usernameCreated = await ensureCredential(
        db,
        identity.id,
        userId,
        envelope.idempotency_key,
        'username',
        user.username,
        keys.active,
      )

      if (created || emailCreated || usernameCreated) {
        report.materialized += 1
      } else {
        report.alreadyConverged += 1
      }
    } catch (error) {
      report.failed.push({
        envelopeId: envelope.id,
        code: error instanceof Error ? error.message : 'AUTH001_MATERIALIZATION_UNKNOWN',
      })
    }
  }

  return report
}
