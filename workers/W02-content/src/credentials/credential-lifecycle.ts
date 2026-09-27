import {
  hashCredentialValue,
  normalizeCredentialValue,
  type CredentialKind,
  type PublicCredential,
} from './credential-add'

export type CredentialReplaceInput = {
  actorUserId: string
  credentialId: string
  value: unknown
  idempotencyKey: string
  secret: string
  now?: string
}

export type CredentialRemoveInput = {
  actorUserId: string
  credentialId: string
  idempotencyKey: string
  now?: string
}

export class CredentialLifecycleError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'PERMISSION_DENIED' | 'NOT_FOUND' | 'CONFLICT' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

type CredentialRow = {
  id: string
  identity_id: string
  kind: CredentialKind
  value_hash: string
  normalized_value: string
  active: number
  active_credential_count?: number
}

function assertId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new CredentialLifecycleError('INVALID_INPUT', field + ' is invalid')
  }
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 255) {
    throw new CredentialLifecycleError('INVALID_INPUT', 'Idempotency-Key is invalid')
  }
}

function assertSecret(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 32) {
    throw new CredentialLifecycleError('INVALID_INPUT', 'credential protection is unavailable')
  }
}

function toPublicCredential(row: Pick<CredentialRow, 'id' | 'kind' | 'active'>): PublicCredential {
  return {
    credentialId: row.id,
    kind: row.kind,
    active: row.active === 1,
  }
}

export async function replaceCredential(
  db: D1Database,
  input: CredentialReplaceInput,
): Promise<PublicCredential> {
  assertId(input.actorUserId, 'actorUserId')
  assertId(input.credentialId, 'credentialId')
  assertIdempotencyKey(input.idempotencyKey)
  assertSecret(input.secret)

  let row: CredentialRow | null
  try {
    row = await db
      .prepare(
        'SELECT c.id, c.identity_id, c.kind, c.value_hash, c.normalized_value, c.active ' +
          'FROM auth_credentials c ' +
          'INNER JOIN auth_identities i ON i.id = c.identity_id ' +
          'WHERE c.id = ? AND i.user_id = ? LIMIT 1',
      )
      .bind(input.credentialId, input.actorUserId)
      .first<CredentialRow>()
  } catch {
    throw new CredentialLifecycleError('UNAVAILABLE', 'credential service unavailable')
  }

  if (!row) {
    throw new CredentialLifecycleError('NOT_FOUND', 'credential not found')
  }
  if (row.active !== 1) {
    throw new CredentialLifecycleError('NOT_FOUND', 'credential not found')
  }

  let normalizedValue: string
  try {
    normalizedValue = normalizeCredentialValue(row.kind, input.value)
  } catch {
    throw new CredentialLifecycleError('INVALID_INPUT', 'credential value is invalid')
  }

  const valueHash = await hashCredentialValue(row.kind, normalizedValue, input.secret)
  const now = input.now ?? new Date().toISOString()

  if (row.normalized_value === normalizedValue && row.value_hash === valueHash) {
    return toPublicCredential(row)
  }

  try {
    const update = await db
      .prepare(
        'UPDATE auth_credentials ' +
          'SET value_hash = ?, normalized_value = ?, verified_at = NULL, updated_at = ? ' +
          'WHERE id = ? AND identity_id = ? AND active = 1',
      )
      .bind(valueHash, normalizedValue, now, row.id, row.identity_id)
      .run()

    if (update.meta?.changes !== undefined && update.meta.changes !== 1) {
      throw new CredentialLifecycleError('CONFLICT', 'credential could not be replaced')
    }

    return {
      credentialId: row.id,
      kind: row.kind,
      active: true,
    }
  } catch (error) {
    if (error instanceof CredentialLifecycleError) throw error
    throw new CredentialLifecycleError('CONFLICT', 'credential could not be replaced')
  }
}

export async function removeCredential(
  db: D1Database,
  input: CredentialRemoveInput,
): Promise<void> {
  assertId(input.actorUserId, 'actorUserId')
  assertId(input.credentialId, 'credentialId')
  assertIdempotencyKey(input.idempotencyKey)

  let row: CredentialRow | null
  try {
    row = await db
      .prepare(
        'SELECT c.id, c.identity_id, c.kind, c.value_hash, c.normalized_value, c.active, ' +
          '(SELECT COUNT(*) FROM auth_credentials active_c ' +
          'INNER JOIN auth_identities active_i ON active_i.id = active_c.identity_id ' +
          'WHERE active_i.user_id = ? AND active_c.active = 1) AS active_credential_count ' +
          'FROM auth_credentials c ' +
          'INNER JOIN auth_identities i ON i.id = c.identity_id ' +
          'WHERE c.id = ? AND i.user_id = ? LIMIT 1',
      )
      .bind(input.actorUserId, input.credentialId, input.actorUserId)
      .first<CredentialRow>()
  } catch {
    throw new CredentialLifecycleError('UNAVAILABLE', 'credential service unavailable')
  }

  if (!row) {
    throw new CredentialLifecycleError('NOT_FOUND', 'credential not found')
  }
  if (row.active !== 1) return

  if ((row.active_credential_count ?? 0) <= 1) {
    throw new CredentialLifecycleError('CONFLICT', 'credential could not be removed')
  }

  try {
    await db
      .prepare(
        'UPDATE auth_credentials SET active = 0, updated_at = ? ' +
          'WHERE id = ? AND identity_id = ? AND active = 1',
      )
      .bind(input.now ?? new Date().toISOString(), row.id, row.identity_id)
      .run()
  } catch {
    throw new CredentialLifecycleError('CONFLICT', 'credential could not be removed')
  }
}
