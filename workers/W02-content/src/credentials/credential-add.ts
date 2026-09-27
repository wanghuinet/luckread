export const CREDENTIAL_KINDS = ['username', 'email', 'phone'] as const

export type CredentialKind = (typeof CREDENTIAL_KINDS)[number]

export type PublicCredential = {
  credentialId: string
  kind: CredentialKind
  active: boolean
}

export type CredentialAddInput = {
  actorUserId: string
  targetUserId: string
  kind: unknown
  value: unknown
  idempotencyKey: string
  secret: string
  now?: string
}

export class CredentialAddError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'PERMISSION_DENIED' | 'CONFLICT' | 'UNAVAILABLE',
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
}

type IdentityRow = {
  id: string
}

function isCredentialKind(value: unknown): value is CredentialKind {
  return typeof value === 'string' && (CREDENTIAL_KINDS as readonly string[]).includes(value)
}

function assertId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
    throw new CredentialAddError('INVALID_INPUT', field + ' is invalid')
  }
}

function assertSecret(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 32) {
    throw new CredentialAddError('INVALID_INPUT', 'credential protection is unavailable')
  }
}

function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 255) {
    throw new CredentialAddError('INVALID_INPUT', 'Idempotency-Key is invalid')
  }
}

export function normalizeCredentialValue(kind: CredentialKind, value: unknown): string {
  if (typeof value !== 'string') {
    throw new CredentialAddError('INVALID_INPUT', 'credential value is invalid')
  }

  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > 320) {
    throw new CredentialAddError('INVALID_INPUT', 'credential value is invalid')
  }

  if (kind === 'phone') {
    if (!/^\+[1-9][0-9]{1,14}$/.test(trimmed)) {
      throw new CredentialAddError('INVALID_INPUT', 'credential value is invalid')
    }
    return trimmed
  }

  return trimmed.normalize('NFC').toLocaleLowerCase('und')
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function deriveCredentialId(userId: string, idempotencyKey: string): Promise<string> {
  const digest = await sha256Hex('luckread-auth003\\0credential\\0' + userId + '\\0' + idempotencyKey)
  return 'auth3_' + digest
}

export async function hashCredentialValue(
  kind: CredentialKind,
  normalizedValue: string,
  secret: string,
): Promise<string> {
  assertSecret(secret)

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const payload = new TextEncoder().encode('luckread-auth003\\0' + kind + '\\0' + normalizedValue)
  const signature = await crypto.subtle.sign('HMAC', key, payload)

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function toPublicCredential(row: CredentialRow): PublicCredential {
  return {
    credentialId: row.id,
    kind: row.kind,
    active: row.active === 1,
  }
}

function sameCredential(
  row: CredentialRow,
  identityId: string,
  kind: CredentialKind,
  valueHash: string,
): boolean {
  return (
    row.identity_id === identityId &&
    row.kind === kind &&
    row.value_hash === valueHash &&
    row.active === 1
  )
}

export async function addCredential(
  db: D1Database,
  input: CredentialAddInput,
): Promise<PublicCredential> {
  assertId(input.actorUserId, 'actorUserId')
  assertId(input.targetUserId, 'targetUserId')
  assertIdempotencyKey(input.idempotencyKey)
  assertSecret(input.secret)

  if (input.actorUserId !== input.targetUserId) {
    throw new CredentialAddError('PERMISSION_DENIED', 'credential management denied')
  }

  if (!isCredentialKind(input.kind)) {
    throw new CredentialAddError('INVALID_INPUT', 'credential kind is invalid')
  }

  const normalizedValue = normalizeCredentialValue(input.kind, input.value)
  const valueHash = await hashCredentialValue(input.kind, normalizedValue, input.secret)
  const credentialId = await deriveCredentialId(input.targetUserId, input.idempotencyKey)
  const now = input.now ?? new Date().toISOString()

  let identity: IdentityRow | undefined

  try {
    identity = await db
      .prepare('SELECT id FROM auth_identities WHERE user_id = ? LIMIT 1')
      .bind(input.targetUserId)
      .first<IdentityRow>()
  } catch {
    throw new CredentialAddError('UNAVAILABLE', 'credential service unavailable')
  }

  if (!identity?.id) {
    throw new CredentialAddError('CONFLICT', 'credential could not be added')
  }

  try {
    const insert = await db
      .prepare(
        'INSERT INTO auth_credentials ' +
          '(id, identity_id, kind, value_hash, normalized_value, verified_at, active, created_at, updated_at) ' +
          'VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?)',
      )
      .bind(
        credentialId,
        identity.id,
        input.kind,
        valueHash,
        normalizedValue,
        now,
        now,
      )
      .run()

    if (insert.meta?.changes !== undefined && insert.meta.changes !== 1) {
      throw new CredentialAddError('CONFLICT', 'credential could not be added')
    }

    return {
      credentialId,
      kind: input.kind,
      active: true,
    }
  } catch (error) {
    if (error instanceof CredentialAddError) throw error

    try {
      const existing = await db
        .prepare(
          'SELECT id, identity_id, kind, value_hash, normalized_value, active ' +
            'FROM auth_credentials WHERE id = ? LIMIT 1',
        )
        .bind(credentialId)
        .first<CredentialRow>()

      if (existing && sameCredential(existing, identity.id, input.kind, valueHash)) {
        return toPublicCredential(existing)
      }
    } catch {
      throw new CredentialAddError('UNAVAILABLE', 'credential service unavailable')
    }

    throw new CredentialAddError('CONFLICT', 'credential could not be added')
  }
}
