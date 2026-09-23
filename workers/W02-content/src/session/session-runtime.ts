export type NativeSessionAuthority = {
  sessionId: string
  userId: string
  createdAt: string
  expiresAt: string
}

export type SessionRecord = {
  sessionId: string
  userId: string
  deviceId: string
  tokenVersion: number
  refreshCredentialHash: string
  revokedAt: string | null
  lastSeenAt: string | null
  nativeExpiresAt: string
}

export class SessionRuntimeError extends Error {
  constructor(
    readonly code: 'UNAUTHENTICATED' | 'INVALID_INPUT' | 'CONFLICT',
    message: string,
  ) {
    super(message)
  }
}

type MutationOptions = {
  randomToken?: () => string
  hashToken?: (token: string) => Promise<string>
  execute?: (
    db: D1Database,
    sql: string,
    bindings: unknown[],
  ) => Promise<{ meta?: { changes?: number } }>
}

const DEFAULT_RANDOM_TOKEN = () => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

const DEFAULT_HASH_TOKEN = async (token: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function assertDeviceId(deviceId: string): void {
  if (typeof deviceId !== 'string' || deviceId.length < 1 || deviceId.length > 128) {
    throw new SessionRuntimeError('INVALID_INPUT', 'deviceId must be 1-128 characters')
  }
}

function assertNativeSession(session: NativeSessionAuthority): void {
  if (!session || typeof session.sessionId !== 'string' || session.sessionId.length === 0) {
    throw new SessionRuntimeError('INVALID_INPUT', 'native session id is required')
  }
  if (typeof session.userId !== 'string' || session.userId.length === 0) {
    throw new SessionRuntimeError('INVALID_INPUT', 'native user id is required')
  }
  if (typeof session.expiresAt !== 'string' || Number.isNaN(Date.parse(session.expiresAt))) {
    throw new SessionRuntimeError('INVALID_INPUT', 'native session expiry is required')
  }
}

function assertNotExpired(expiresAt: string, now: string): void {
  if (Date.parse(now) >= Date.parse(expiresAt)) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'session is expired')
  }
}

export async function createSessionExtension(
  db: D1Database,
  session: NativeSessionAuthority,
  deviceId: string,
  now: string,
  tokenVersion: number,
  options: MutationOptions = {},
): Promise<{ sessionId: string; refreshToken: string }> {
  assertNativeSession(session)
  assertDeviceId(deviceId)
  if (!Number.isInteger(tokenVersion) || tokenVersion < 0) {
    throw new SessionRuntimeError('INVALID_INPUT', 'tokenVersion must be a non-negative integer')
  }
  assertNotExpired(session.expiresAt, now)

  const randomToken = options.randomToken ?? DEFAULT_RANDOM_TOKEN
  const hashToken = options.hashToken ?? DEFAULT_HASH_TOKEN
  const execute =
    options.execute ??
    (async (database, sql, bindings) => database.prepare(sql).bind(...bindings).run())

  const refreshToken = randomToken()
  const refreshCredentialHash = await hashToken(refreshToken)
  const sql = `
    INSERT INTO auth_session_state
      (session_id, user_id, device_id, token_version, refresh_credential_hash, revoked_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `

  try {
    const result = await execute(db, sql, [
      session.sessionId,
      session.userId,
      deviceId,
      tokenVersion,
      refreshCredentialHash,
      now,
    ])
    if (result.meta?.changes !== undefined && result.meta.changes !== 1) {
      throw new SessionRuntimeError('CONFLICT', 'session extension creation was not applied')
    }
  } catch (error) {
    if (error instanceof SessionRuntimeError) throw error
    throw new SessionRuntimeError('CONFLICT', 'session extension creation failed')
  }

  return { sessionId: session.sessionId, refreshToken }
}

export async function rotateRefreshCredential(
  db: D1Database,
  input: {
    refreshToken: string
    deviceId: string
    now: string
    issueAccessToken: (session: SessionRecord) => string
    randomToken?: () => string
    hashToken?: (token: string) => Promise<string>
  },
): Promise<{ sessionId: string; accessToken: string; refreshToken: string }> {
  assertDeviceId(input.deviceId)
  if (typeof input.refreshToken !== 'string' || input.refreshToken.length < 1) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  const hashToken = input.hashToken ?? DEFAULT_HASH_TOKEN
  const refreshCredentialHash = await hashToken(input.refreshToken)

  const selectSql = `
    SELECT
      a.session_id AS sessionId,
      a.user_id AS userId,
      a.device_id AS deviceId,
      a.token_version AS tokenVersion,
      a.refresh_credential_hash AS refreshCredentialHash,
      a.revoked_at AS revokedAt,
      a.last_seen_at AS lastSeenAt,
      s.expires_at AS nativeExpiresAt
    FROM auth_session_state AS a
    INNER JOIN users_sessions AS s
      ON s.id = a.session_id
     AND CAST(s._parent_id AS TEXT) = a.user_id
    WHERE a.refresh_credential_hash = ?
    LIMIT 1
  `

  let result: { results: SessionRecord[] }
  try {
    result = await db.prepare(selectSql).bind(refreshCredentialHash).all<SessionRecord>()
  } catch {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  const session = result.results[0]
  if (!session) throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  if (session.deviceId !== input.deviceId) throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  if (session.revokedAt) throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  if (typeof session.nativeExpiresAt !== 'string') throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid session')
  assertNotExpired(session.nativeExpiresAt, input.now)

  const randomToken = input.randomToken ?? DEFAULT_RANDOM_TOKEN
  const nextRefreshToken = randomToken()
  const nextHash = await hashToken(nextRefreshToken)

  const updateSql = `
    UPDATE auth_session_state
       SET refresh_credential_hash = ?,
           last_seen_at = ?
     WHERE session_id = ?
       AND refresh_credential_hash = ?
       AND revoked_at IS NULL
  `

  let updateResult: { meta?: { changes?: number } }
  try {
    updateResult = await db
      .prepare(updateSql)
      .bind(nextHash, input.now, session.sessionId, refreshCredentialHash)
      .run()
  } catch {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  if (updateResult.meta?.changes !== 1) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  const accessToken = input.issueAccessToken({
    ...session,
    refreshCredentialHash: nextHash,
    lastSeenAt: input.now,
  })

  return {
    sessionId: session.sessionId,
    accessToken,
    refreshToken: nextRefreshToken,
  }
}

export async function revokeSessionExtension(
  db: D1Database,
  sessionId: string,
  now: string,
): Promise<{ revoked: boolean }> {
  if (!sessionId) throw new SessionRuntimeError('INVALID_INPUT', 'sessionId is required')

  const sql = `
    UPDATE auth_session_state
       SET revoked_at = COALESCE(revoked_at, ?),
           last_seen_at = ?
     WHERE session_id = ?
  `

  try {
    await db.prepare(sql).bind(now, now, sessionId).run()
  } catch {
    throw new SessionRuntimeError('CONFLICT', 'session revocation failed')
  }

  return { revoked: true }
}


import { resolveGlobalLayer, type LayerResolution } from '../authz/role-assignment.js'

type LayerResolver = (
  db: D1Database,
  subjectId: string,
  accountState: string,
  now: string,
) => Promise<LayerResolution>

export async function establishAuthenticatedSession(
  db: D1Database,
  session: NativeSessionAuthority,
  deviceId: string,
  accountState: string,
  now: string,
  tokenVersion: number,
  options: MutationOptions & { resolveLayer?: LayerResolver } = {},
): Promise<{ sessionId: string; refreshToken: string; layer: string }> {
  if (typeof accountState !== 'string' || accountState.length === 0) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'authoritative account state is required')
  }

  const resolveLayer = options.resolveLayer ?? resolveGlobalLayer
  const layerResolution = await resolveLayer(db, session.userId, accountState, now)
  if (layerResolution.decision !== 'ALLOW' || !layerResolution.layer) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'account authorization denied')
  }

  const extension = await createSessionExtension(
    db,
    session,
    deviceId,
    now,
    tokenVersion,
    options,
  )

  return { ...extension, layer: layerResolution.layer }
}

export async function refreshAuthenticatedSession(
  db: D1Database,
  input: {
    refreshToken: string
    deviceId: string
    accountState: string
    now: string
    issueAccessToken: (session: SessionRecord) => string
    randomToken?: () => string
    hashToken?: (token: string) => Promise<string>
    resolveLayer?: LayerResolver
  },
): Promise<{ sessionId: string; accessToken: string; refreshToken: string; layer: string }> {
  if (typeof input.accountState !== 'string' || input.accountState.length === 0) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'authoritative account state is required')
  }

  const resolveLayer = input.resolveLayer ?? resolveGlobalLayer
  let rotatedSession: SessionRecord | null = null
  const rotated = await rotateRefreshCredential(db, {
    refreshToken: input.refreshToken,
    deviceId: input.deviceId,
    now: input.now,
    issueAccessToken: (session) => {
      rotatedSession = session
      return input.issueAccessToken(session)
    },
    ...(input.randomToken ? { randomToken: input.randomToken } : {}),
    ...(input.hashToken ? { hashToken: input.hashToken } : {}),
  })

  if (!rotatedSession) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'session state is unavailable')
  }

  let layerResolution: LayerResolution
  try {
    layerResolution = await resolveLayer(db, rotatedSession.userId, input.accountState, input.now)
  } catch {
    await revokeSessionExtension(db, rotatedSession.sessionId, input.now)
    throw new SessionRuntimeError('UNAUTHENTICATED', 'account authorization unavailable')
  }

  if (layerResolution.decision !== 'ALLOW' || !layerResolution.layer) {
    await revokeSessionExtension(db, rotatedSession.sessionId, input.now)
    throw new SessionRuntimeError('UNAUTHENTICATED', 'account authorization denied')
  }

  return { ...rotated, layer: layerResolution.layer }
}
