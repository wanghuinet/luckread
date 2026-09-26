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

function encodeVersionedRefreshToken(tokenVersion: number, rawToken: string): string {
  if (!Number.isInteger(tokenVersion) || tokenVersion < 0 || !rawToken) {
    throw new SessionRuntimeError('INVALID_INPUT', 'refresh token version is invalid')
  }
  return 'v' + tokenVersion + '.' + rawToken
}

function parseRefreshTokenVersion(refreshToken: string): number | null {
  const match = /^v(\d+)\.(.+)$/.exec(refreshToken)
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) && version >= 0 ? version : null
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

  const refreshToken = encodeVersionedRefreshToken(tokenVersion, randomToken())
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

export async function revokeSessionExtension(
  db: D1Database,
  sessionId: string,
  now: string,
): Promise<{ revoked: boolean }> {
  if (!sessionId) throw new SessionRuntimeError('INVALID_INPUT', 'sessionId is required')

  const extensionStatement = db
    .prepare(`
      UPDATE auth_session_state
         SET revoked_at = ?,
             last_seen_at = ?,
             token_version = token_version + 1
       WHERE session_id = ?
         AND revoked_at IS NULL
    `)
    .bind(now, now, sessionId)

  const nativeSessionStatement = db
    .prepare('DELETE FROM users_sessions WHERE id = ?')
    .bind(sessionId)

  try {
    const results = await db.batch([extensionStatement, nativeSessionStatement])
    if (results.length !== 2) {
      throw new SessionRuntimeError('CONFLICT', 'session revocation batch was incomplete')
    }

    // W02 owns the authoritative revocation mutation: the extension state and
    // the corresponding Payload-native session are changed together.
    const extensionChanged = results[0]?.meta?.changes === 1
    const nativeSessionChanged = results[1]?.meta?.changes === 1
    return { revoked: extensionChanged || nativeSessionChanged }
  } catch (error) {
    if (error instanceof SessionRuntimeError) throw error
    throw new SessionRuntimeError('CONFLICT', 'session revocation failed')
  }
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

type AuthoritativeSessionContext = {
  session: NativeSessionAuthority
  accountState: string
}

async function loadAuthoritativeLoginSession(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<AuthoritativeSessionContext> {
  if (!userId || !sessionId) {
    throw new SessionRuntimeError('INVALID_INPUT', 'authoritative user and session ids are required')
  }

  try {
    const row = await db
      .prepare(
        `
        SELECT
          s.id AS sessionId,
          CAST(s._parent_id AS TEXT) AS userId,
          s.created_at AS createdAt,
          s.expires_at AS expiresAt,
          u.account_state AS accountState
        FROM users_sessions AS s
        INNER JOIN users AS u
          ON CAST(u.id AS TEXT) = CAST(s._parent_id AS TEXT)
        WHERE s.id = ?
          AND CAST(s._parent_id AS TEXT) = ?
        LIMIT 1
        `,
      )
      .bind(sessionId, userId)
      .first<{
        sessionId: string
        userId: string
        createdAt: string
        expiresAt: string
        accountState: string
      }>()

    if (!row || typeof row.accountState !== 'string' || row.accountState.length === 0) {
      throw new SessionRuntimeError('UNAUTHENTICATED', 'native session or account state unavailable')
    }

    return {
      session: {
        sessionId: row.sessionId,
        userId: row.userId,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
      },
      accountState: row.accountState,
    }
  } catch (error) {
    if (error instanceof SessionRuntimeError) throw error
    throw new SessionRuntimeError('UNAUTHENTICATED', 'native session or account state unavailable')
  }
}

export async function establishSessionFromAuthoritativeD1(
  db: D1Database,
  input: {
    sessionId: string
    userId: string
    deviceId: string
    now?: string
    resolveLayer?: LayerResolver
    randomToken?: () => string
    hashToken?: (token: string) => Promise<string>
    execute?: MutationOptions['execute']
  },
): Promise<{ sessionId: string; refreshToken: string; tokenVersion: number; layer: string; nativeExpiresAt: string }> {
  const now = input.now ?? new Date().toISOString()
  const context = await loadAuthoritativeLoginSession(db, input.userId, input.sessionId)
  const extension = await establishAuthenticatedSession(
    db,
    context.session,
    input.deviceId,
    context.accountState,
    now,
    1,
    {
      resolveLayer: input.resolveLayer,
      randomToken: input.randomToken,
      hashToken: input.hashToken,
      execute: input.execute,
    },
  )

  return {
    ...extension,
    tokenVersion: 1,
    nativeExpiresAt: context.session.expiresAt,
  }
}

type AuthoritativeRefreshResult = {
  sessionId: string
  userId: string
  refreshToken: string
  tokenVersion: number
  layer: string
  nativeExpiresAt: string
  email: string
}

function assertRefreshSessionUsable(session: SessionRecord, deviceId: string, now: string): void {
  if (session.deviceId !== deviceId) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }
  if (session.revokedAt) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }
  if (typeof session.nativeExpiresAt !== 'string') {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid session')
  }
  assertNotExpired(session.nativeExpiresAt, now)
}

async function rotateLoadedRefreshCredential(
  db: D1Database,
  session: SessionRecord,
  expectedRefreshCredentialHash: string,
  now: string,
  randomToken: () => string,
  hashToken: (token: string) => Promise<string>,
): Promise<{ refreshToken: string; refreshCredentialHash: string }> {
  const refreshToken = encodeVersionedRefreshToken(session.tokenVersion, randomToken())
  const refreshCredentialHash = await hashToken(refreshToken)

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
      .bind(refreshCredentialHash, now, session.sessionId, expectedRefreshCredentialHash)
      .run()
  } catch {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  if (updateResult.meta?.changes !== 1) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  return { refreshToken, refreshCredentialHash }
}

async function loadAuthoritativeRefreshContext(
  db: D1Database,
  refreshCredentialHash: string,
): Promise<{
  session: SessionRecord
  accountState: string
  email: string
}> {
  try {
    const row = await db
      .prepare(
        `
        SELECT
          a.session_id AS sessionId,
          a.user_id AS userId,
          a.device_id AS deviceId,
          a.token_version AS tokenVersion,
          a.refresh_credential_hash AS refreshCredentialHash,
          a.revoked_at AS revokedAt,
          a.last_seen_at AS lastSeenAt,
          s.expires_at AS nativeExpiresAt,
          u.account_state AS accountState,
          u.email AS email
        FROM auth_session_state AS a
        INNER JOIN users_sessions AS s
          ON s.id = a.session_id
         AND CAST(s._parent_id AS TEXT) = a.user_id
        INNER JOIN users AS u
          ON CAST(u.id AS TEXT) = a.user_id
        WHERE a.refresh_credential_hash = ?
        LIMIT 1
        `,
      )
      .bind(refreshCredentialHash)
      .first<SessionRecord & { accountState: string; email: string }>()

    if (
      !row ||
      typeof row.accountState !== 'string' ||
      row.accountState.length === 0 ||
      typeof row.email !== 'string' ||
      row.email.length === 0
    ) {
      throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
    }

    return {
      session: row,
      accountState: row.accountState,
      email: row.email,
    }
  } catch (error) {
    if (error instanceof SessionRuntimeError) throw error
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }
}

export async function validateAuthoritativeSession(
  db: D1Database,
  input: {
    userId: string
    sessionId: string
    tokenVersion: number
    now?: string
  },
): Promise<{ active: boolean }> {
  if (!input.userId || !input.sessionId) {
    throw new SessionRuntimeError('INVALID_INPUT', 'authoritative user and session ids are required')
  }

  const now = input.now ?? new Date().toISOString()
  try {
    const row = await db
      .prepare(
        `
        SELECT
          CAST(s.id AS TEXT) AS sessionId,
          CAST(s._parent_id AS TEXT) AS userId,
          s.expires_at AS expiresAt,
          a.user_id AS extensionUserId,
          a.token_version AS tokenVersion,
          a.revoked_at AS revokedAt,
          u.account_state AS accountState
        FROM users_sessions AS s
        INNER JOIN auth_session_state AS a
          ON CAST(a.session_id AS TEXT) = CAST(s.id AS TEXT)
        INNER JOIN users AS u
          ON CAST(u.id AS TEXT) = CAST(s._parent_id AS TEXT)
        WHERE CAST(s.id AS TEXT) = ?
          AND CAST(s._parent_id AS TEXT) = ?
        LIMIT 1
        `,
      )
      .bind(String(input.sessionId), String(input.userId))
      .first<{
        sessionId: string
        userId: string
        expiresAt: string
        extensionUserId: string
        tokenVersion: number
        revokedAt: string | null
        accountState: string
      }>()

    if (!row) return { active: false }
    if (String(row.sessionId) !== String(input.sessionId)) return { active: false }
    if (String(row.userId) !== String(input.userId)) return { active: false }
    if (String(row.extensionUserId) !== String(input.userId)) return { active: false }
    if (row.tokenVersion !== input.tokenVersion) return { active: false }
    if (row.accountState !== 'ACTIVE' || row.revokedAt) return { active: false }
    if (Number.isNaN(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= Date.parse(now)) {
      return { active: false }
    }

    return { active: true }
  } catch {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'authoritative session unavailable')
  }
}


export async function refreshSessionFromAuthoritativeD1(
  db: D1Database,
  input: {
    refreshToken: string
    deviceId: string
    now?: string
    resolveLayer?: LayerResolver
    randomToken?: () => string
    hashToken?: (token: string) => Promise<string>
  },
): Promise<AuthoritativeRefreshResult> {
  const now = input.now ?? new Date().toISOString()
  assertDeviceId(input.deviceId)
  if (typeof input.refreshToken !== 'string' || input.refreshToken.length < 1) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  const hashToken = input.hashToken ?? DEFAULT_HASH_TOKEN
  const credentialVersion = parseRefreshTokenVersion(input.refreshToken)
  if (credentialVersion === null) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }
  const refreshCredentialHash = await hashToken(input.refreshToken)
  const context = await loadAuthoritativeRefreshContext(db, refreshCredentialHash)

  if (credentialVersion !== context.session.tokenVersion) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'invalid refresh credential')
  }

  assertRefreshSessionUsable(context.session, input.deviceId, now)

  const resolveLayer = input.resolveLayer ?? resolveGlobalLayer
  let layerResolution: LayerResolution
  try {
    layerResolution = await resolveLayer(db, context.session.userId, context.accountState, now)
  } catch {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'account authorization unavailable')
  }

  if (layerResolution.decision !== 'ALLOW' || !layerResolution.layer) {
    throw new SessionRuntimeError('UNAUTHENTICATED', 'account authorization denied')
  }

  const randomToken = input.randomToken ?? DEFAULT_RANDOM_TOKEN
  const rotated = await rotateLoadedRefreshCredential(
    db,
    context.session,
    refreshCredentialHash,
    now,
    randomToken,
    hashToken,
  )

  return {
    sessionId: context.session.sessionId,
    userId: context.session.userId,
    refreshToken: rotated.refreshToken,
    tokenVersion: context.session.tokenVersion,
    layer: layerResolution.layer,
    nativeExpiresAt: context.session.nativeExpiresAt,
    email: context.email,
  }
}
