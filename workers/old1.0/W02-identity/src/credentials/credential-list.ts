export const CREDENTIAL_LIST_ENDPOINT = 'authCredentialList' as const
export const CREDENTIAL_LIST_ORDERING = 'createdAt DESC, credentialId DESC' as const
export const CREDENTIAL_LIST_DEFAULT_LIMIT = 50
export const CREDENTIAL_LIST_MAX_LIMIT = 100

export type CredentialKind = 'username' | 'email' | 'phone'

export type PublicCredential = {
  credentialId: string
  kind: CredentialKind
  active: boolean
}

export type CredentialListInput = {
  actorUserId: string
  limit?: number
  cursor?: string | null
  requestId: string
  traceId?: string
}

export type CredentialListResult = {
  data: {
    items: PublicCredential[]
    nextCursor: string | null
    hasMore: boolean
  }
  requestId: string
  traceId?: string
}

export class CredentialListError extends Error {
  constructor(
    readonly code: 'VALIDATION_FAILED' | 'INVALID_CURSOR' | 'SERVICE_UNAVAILABLE',
    message: string,
  ) {
    super(message)
  }
}

type CursorPayload = {
  v: 1
  endpoint: typeof CREDENTIAL_LIST_ENDPOINT
  ordering: typeof CREDENTIAL_LIST_ORDERING
  createdAt: string
  credentialId: string
}

type CredentialRow = {
  id: string
  kind: CredentialKind
  active: number
  created_at: string
  has_more: number
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): string {
  if (!value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CredentialListError('INVALID_CURSOR', 'cursor is invalid')
  }

  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    throw new CredentialListError('INVALID_CURSOR', 'cursor is invalid')
  }

  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  try {
    return new TextDecoder().decode(bytes)
  } catch {
    throw new CredentialListError('INVALID_CURSOR', 'cursor is invalid')
  }
}

function encodeCursor(row: Pick<CredentialRow, 'created_at' | 'id'>): string {
  const payload: CursorPayload = {
    v: 1,
    endpoint: CREDENTIAL_LIST_ENDPOINT,
    ordering: CREDENTIAL_LIST_ORDERING,
    createdAt: row.created_at,
    credentialId: row.id,
  }
  return encodeBase64Url(JSON.stringify(payload))
}

function decodeCursor(cursor: string): CursorPayload {
  let payload: unknown
  try {
    payload = JSON.parse(decodeBase64Url(cursor))
  } catch (error) {
    if (error instanceof CredentialListError) throw error
    throw new CredentialListError('INVALID_CURSOR', 'cursor is invalid')
  }

  if (!payload || typeof payload !== 'object') {
    throw new CredentialListError('INVALID_CURSOR', 'cursor is invalid')
  }

  const candidate = payload as Record<string, unknown>
  if (
    candidate.v !== 1 ||
    candidate.endpoint !== CREDENTIAL_LIST_ENDPOINT ||
    candidate.ordering !== CREDENTIAL_LIST_ORDERING ||
    typeof candidate.createdAt !== 'string' ||
    typeof candidate.credentialId !== 'string' ||
    candidate.createdAt.length === 0 ||
    Number.isNaN(Date.parse(candidate.createdAt)) ||
    candidate.credentialId.length === 0
  ) {
    throw new CredentialListError('INVALID_CURSOR', 'cursor is invalid')
  }

  return {
    v: 1,
    endpoint: CREDENTIAL_LIST_ENDPOINT,
    ordering: CREDENTIAL_LIST_ORDERING,
    createdAt: candidate.createdAt,
    credentialId: candidate.credentialId,
  }
}

function assertLimit(limit: number | undefined): number {
  const resolved = limit ?? CREDENTIAL_LIST_DEFAULT_LIMIT
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > CREDENTIAL_LIST_MAX_LIMIT) {
    throw new CredentialListError('VALIDATION_FAILED', 'limit is invalid')
  }
  return resolved
}

function assertRequestIdentity(actorUserId: string, requestId: string): void {
  if (
    typeof actorUserId !== 'string' ||
    actorUserId.trim().length === 0 ||
    actorUserId.length > 128
  ) {
    throw new CredentialListError('VALIDATION_FAILED', 'actorUserId is invalid')
  }
  if (
    typeof requestId !== 'string' ||
    requestId.trim().length === 0 ||
    requestId.length > 255
  ) {
    throw new CredentialListError('VALIDATION_FAILED', 'requestId is invalid')
  }
}

function project(row: CredentialRow): PublicCredential {
  return {
    credentialId: row.id,
    kind: row.kind,
    active: row.active === 1,
  }
}

export function encodeCredentialListCursorForTest(row: Pick<CredentialRow, 'created_at' | 'id'>): string {
  return encodeCursor(row)
}

export async function listCredentials(
  db: D1Database,
  input: CredentialListInput,
): Promise<CredentialListResult> {
  assertRequestIdentity(input.actorUserId, input.requestId)
  const limit = assertLimit(input.limit)

  let cursor: CursorPayload | undefined
  if (input.cursor) cursor = decodeCursor(input.cursor)

  try {
    const query = cursor
      ? [
          'SELECT c.id, c.kind, c.active, c.created_at,',
          'EXISTS (',
          '  SELECT 1',
          '  FROM auth_credentials next_c',
          '  INNER JOIN auth_identities next_i ON next_i.id = next_c.identity_id',
          '  WHERE next_i.user_id = i.user_id',
          '    AND (next_c.created_at < c.created_at OR (next_c.created_at = c.created_at AND next_c.id < c.id))',
          ') AS has_more',
          'FROM auth_credentials c',
          'INNER JOIN auth_identities i ON i.id = c.identity_id',
          'WHERE i.user_id = ?',
          '  AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))',
          'ORDER BY c.created_at DESC, c.id DESC',
          'LIMIT ?',
        ].join(' ')
      : [
          'SELECT c.id, c.kind, c.active, c.created_at,',
          'EXISTS (',
          '  SELECT 1',
          '  FROM auth_credentials next_c',
          '  INNER JOIN auth_identities next_i ON next_i.id = next_c.identity_id',
          '  WHERE next_i.user_id = i.user_id',
          '    AND (next_c.created_at < c.created_at OR (next_c.created_at = c.created_at AND next_c.id < c.id))',
          ') AS has_more',
          'FROM auth_credentials c',
          'INNER JOIN auth_identities i ON i.id = c.identity_id',
          'WHERE i.user_id = ?',
          'ORDER BY c.created_at DESC, c.id DESC',
          'LIMIT ?',
        ].join(' ')

    const statement = cursor
      ? db
          .prepare(query)
          .bind(
            input.actorUserId,
            cursor.createdAt,
            cursor.createdAt,
            cursor.credentialId,
            limit,
          )
      : db.prepare(query).bind(input.actorUserId, limit)

    const result = await statement.all<CredentialRow>()
    const rows = result.results ?? []
    const last = rows.at(-1)
    const hasMore = Boolean(last?.has_more === 1)

    return {
      data: {
        items: rows.map(project),
        nextCursor: last && hasMore ? encodeCursor(last) : null,
        hasMore,
      },
      requestId: input.requestId,
      ...(input.traceId ? { traceId: input.traceId } : {}),
    }
  } catch (error) {
    if (error instanceof CredentialListError) throw error
    throw new CredentialListError('SERVICE_UNAVAILABLE', 'credential service unavailable')
  }
}
