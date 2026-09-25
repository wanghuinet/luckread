import { getCloudflareContext } from '@opennextjs/cloudflare'

export type D1DatabaseLike = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>
    }
  }
}

type SessionBoundUser = {
  id?: string | number
  _sid?: string
}

type JwtClaims = {
  id?: string | number
  collection?: string
  sid?: string
  tokenVersion?: number
}

function decodeBase64UrlJson(value: string): Record<string, unknown> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return JSON.parse(atob(padded)) as Record<string, unknown>
}

function readAccessTokenClaims(request: Request): JwtClaims | null {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null

  const token = authorization.slice('Bearer '.length).trim()
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    return decodeBase64UrlJson(parts[1]) as JwtClaims
  } catch {
    return null
  }
}

export async function isAuthoritativeSessionActive(
  request: Request,
  user: SessionBoundUser,
): Promise<boolean> {
  if (!user?.id || !user._sid) return false

  const claims = readAccessTokenClaims(request)
  if (
    !claims ||
    String(claims.id ?? '') !== String(user.id) ||
    claims.collection !== 'users' ||
    claims.sid !== String(user._sid) ||
    !Number.isInteger(claims.tokenVersion)
  ) {
    return false
  }

  try {
    const context = await getCloudflareContext({ async: true })
    const env = context.env as unknown as { D1?: D1DatabaseLike }
    if (!env.D1) return false

    const row = await env.D1
      .prepare(
        `SELECT
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
         LIMIT 1`
      )
      .bind(String(user._sid), String(user.id))
      .first<{
        sessionId: string
        userId: string
        expiresAt: string
        extensionUserId: string
        tokenVersion: number
        revokedAt: string | null
        accountState: string
      }>()

    if (!row) return false
    if (String(row.sessionId) !== String(user._sid)) return false
    if (String(row.userId) !== String(user.id)) return false
    if (String(row.extensionUserId) !== String(user.id)) return false
    if (row.accountState !== 'ACTIVE') return false
    if (row.revokedAt) return false

    const expiresAtMs = Date.parse(row.expiresAt)
    if (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs) return false

    return Number(claims.tokenVersion) === Number(row.tokenVersion)
  } catch {
    return false
  }
}
