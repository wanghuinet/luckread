import usernameReservationPolicy from '../../../../contracts/security/username-reservation-policy.v1.json'
import type { BetterAuthEnv } from './better-auth.js'
import { resolveBetterAuthPrincipal, type AuthenticatedPrincipal } from './principal.js'

const COOLDOWN_MS = Number(usernameReservationPolicy.ownerDecision.renameCooldownDays) * 24 * 60 * 60 * 1000
const RESERVATION_MS = Number(usernameReservationPolicy.ownerDecision.previousUsernameReservationDays) * 24 * 60 * 60 * 1000
const IDEMPOTENCY_RETENTION_MS = Number(usernameReservationPolicy.ownerDecision.idempotencyRetentionHours) * 60 * 60 * 1000
const RESERVED_USERNAMES = new Set(usernameReservationPolicy.reservation.reservedUsernames)
const USERNAME_PATTERN = /^[A-Za-z0-9]{6,32}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,255}$/
const ETAG_PATTERN = /^"username-v(0|[1-9][0-9]*)"$/

type UsernameCandidate = { display: string; normalized: string }
type UsernameContext = {
  username: string | null
  accountState: string
  usernameVersion: number
  lastChangedAt: string | null
  replayKeyHash: string | null
  replayUsername: string | null
  replayFingerprint: string | null
  replayChangedAt: string | null
  replayExpiresAt: string | null
}

const CONTEXT_SQL = [
  'SELECT u.username AS username, u.account_state AS accountState,',
  '       COALESCE(s.username_version, 0) AS usernameVersion,',
  '       s.last_changed_at AS lastChangedAt,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.idempotency_key_hash END AS replayKeyHash,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.changed_username END AS replayUsername,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.request_fingerprint END AS replayFingerprint,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.last_changed_at END AS replayChangedAt,',
  '       CASE WHEN s.idempotency_key_hash = ? AND s.idempotency_expires_at > ? THEN s.idempotency_expires_at END AS replayExpiresAt',
  'FROM "user" u',
  'LEFT JOIN auth_username_change_state s ON s.user_id = u.id',
  'WHERE u.id = ? LIMIT 1',
].join('\n')

const STATE_SQL = [
  'SELECT u.username AS username, u.account_state AS accountState,',
  '       COALESCE(s.username_version, 0) AS usernameVersion,',
  '       s.last_changed_at AS lastChangedAt',
  'FROM "user" u',
  'LEFT JOIN auth_username_change_state s ON s.user_id = u.id',
  'WHERE u.id = ? LIMIT 1',
].join('\n')

const json = (body: unknown, status = 200, headers?: HeadersInit): Response => {
  const outputHeaders = new Headers(headers)
  outputHeaders.set('cache-control', 'no-store')
  outputHeaders.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers: outputHeaders })
}

const error = (status: number, code: string, message: string, details?: Record<string, unknown>, headers?: HeadersInit): Response =>
  json({ error: { code, message, ...(details ? { details } : {}) } }, status, headers)

const callerAllowed = (request: Request): boolean =>
  request.headers.get('X-LuckRead-Caller') === 'W01' &&
  request.headers.get('X-LuckRead-Transport-Version') === '1.0'

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function hashUsernameIdempotencyKey(value: string): Promise<string> {
  return sha256Hex(value)
}

export function normalizeUsernameCandidate(value: string): UsernameCandidate | null {
  const display = value.trim().normalize('NFC')
  if (!USERNAME_PATTERN.test(display)) return null
  // For the accepted ASCII-only namespace, lowercase is equivalent to Unicode casefold.
  return { display, normalized: display.toLowerCase() }
}

export function isReservedUsername(normalized: string): boolean {
  return RESERVED_USERNAMES.has(normalized)
}

export async function fingerprintUsernameChange(display: string, ifMatch: string): Promise<string> {
  return sha256Hex(display + '\0' + ifMatch)
}

const etagForVersion = (version: number): string => '"username-v' + String(version) + '"'

function contextFromRow(row: UsernameContext | null): UsernameContext | null {
  if (!row || typeof row.accountState !== 'string' ||
      !Number.isSafeInteger(Number(row.usernameVersion)) || Number(row.usernameVersion) < 0) return null
  return { ...row, usernameVersion: Number(row.usernameVersion) }
}

async function loadContext(
  env: BetterAuthEnv,
  userId: string,
  idempotencyKeyHash: string,
  nowIso: string,
): Promise<UsernameContext | null> {
  const row = await env.D1_01.prepare(CONTEXT_SQL).bind(
    idempotencyKeyHash, nowIso,
    idempotencyKeyHash, nowIso,
    idempotencyKeyHash, nowIso,
    idempotencyKeyHash, nowIso,
    idempotencyKeyHash, nowIso,
    userId,
  ).first<UsernameContext>()
  return contextFromRow(row)
}

type UsernameAuthentication =
  | { ok: true; principal: AuthenticatedPrincipal }
  | { ok: false; response: Response }

async function authenticate(env: BetterAuthEnv, request: Request): Promise<UsernameAuthentication> {
  try {
    const principal = await resolveBetterAuthPrincipal(env, request)
    if (!principal) return { ok: false, response: error(401, 'UNAUTHENTICATED', 'Authentication required') }
    if (principal.accountState !== 'ACTIVE') {
      return { ok: false, response: error(403, 'ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible for this operation') }
    }
    return { ok: true, principal }
  } catch {
    return { ok: false, response: error(503, 'SERVICE_UNAVAILABLE', 'Username service unavailable') }
  }
}

async function checkLimits(
  binding: BetterAuthEnv['AUTH_SESSION_READ_LIMITER'] | BetterAuthEnv['AUTH_SESSION_WRITE_LIMITER'],
  keys: string[],
): Promise<'limited' | 'unavailable' | null> {
  if (!binding) return 'unavailable'
  for (const key of keys) {
    try {
      const result = await binding.limit({ key })
      if (!result || typeof result.success !== 'boolean') return 'unavailable'
      if (!result.success) return 'limited'
    } catch { return 'unavailable' }
  }
  return null
}

function rateLimitResponse(result: 'limited' | 'unavailable'): Response {
  if (result === 'limited') return error(429, 'RATE_LIMITED', 'Too many username requests', { retryAfter: 60 }, { 'retry-after': '60' })
  return error(503, 'SERVICE_UNAVAILABLE', 'Username rate limiter unavailable')
}

async function enforceReadLimits(env: BetterAuthEnv, userId: string): Promise<Response | null> {
  const result = await checkLimits(env.AUTH_SESSION_READ_LIMITER, [
    'username-state:account:' + userId, 'username-state:endpoint',
  ])
  return result ? rateLimitResponse(result) : null
}

async function enforceWriteLimits(env: BetterAuthEnv, request: Request, userId: string): Promise<Response | null> {
  const deviceMaterial = [request.headers.get('cf-connecting-ip') ?? '', request.headers.get('user-agent') ?? ''].join('\0')
  const deviceHash = await sha256Hex(deviceMaterial)
  const result = await checkLimits(env.AUTH_SESSION_WRITE_LIMITER, [
    'username-change:account:' + userId,
    'username-change:identity:' + userId,
    'username-change:device:' + deviceHash,
    'username-change:endpoint',
    'username-change:global',
  ])
  return result ? rateLimitResponse(result) : null
}

function cooldownEndsAt(lastChangedAt: string | null): string | null {
  if (!lastChangedAt) return null
  const timestamp = Date.parse(lastChangedAt)
  if (!Number.isFinite(timestamp)) throw new Error('USERNAME_CHANGE_TIMESTAMP_INVALID')
  return new Date(timestamp + COOLDOWN_MS).toISOString()
}

function stateDto(context: UsernameContext) {
  return {
    username: context.username,
    usernameVersion: context.usernameVersion,
    lastChangedAt: context.lastChangedAt,
    canChangeAt: cooldownEndsAt(context.lastChangedAt),
  }
}

function replayResponse(context: UsernameContext, now = new Date()): Response {
  if (!context.replayUsername || !context.replayChangedAt || !context.replayExpiresAt ||
      !Number.isFinite(Date.parse(context.replayExpiresAt)) ||
      Date.parse(context.replayExpiresAt) <= now.getTime() ||
      !Number.isSafeInteger(Number(context.usernameVersion))) {
    return error(503, 'SERVICE_UNAVAILABLE', 'Username idempotency record is invalid')
  }
  return json({
    data: {
      username: context.replayUsername,
      usernameVersion: context.usernameVersion,
      changedAt: context.replayChangedAt,
      canChangeAt: cooldownEndsAt(context.replayChangedAt),
    },
    meta: { idempotentReplay: true },
  }, 200, { ETag: etagForVersion(context.usernameVersion) })
}

export async function handleUsernameStateRequest(env: BetterAuthEnv, request: Request): Promise<Response> {
  if (!callerAllowed(request)) return error(403, 'FORBIDDEN', 'Authorized W01 service boundary required')
  const auth = await authenticate(env, request)
  if (!auth.ok) return auth.response
  const limited = await enforceReadLimits(env, auth.principal.userId)
  if (limited) return limited

  try {
    const row = await env.D1_01.prepare(STATE_SQL).bind(auth.principal.userId)
      .first<Omit<UsernameContext, 'replayKeyHash' | 'replayFingerprint' | 'replayChangedAt' | 'replayExpiresAt'>>()
    if (!row || typeof row.accountState !== 'string') return error(404, 'NOT_FOUND', 'Username record not found')
    if (row.accountState !== 'ACTIVE') return error(403, 'ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible for this operation')
    const version = Number(row.usernameVersion)
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('USERNAME_VERSION_INVALID')
    const data = stateDto({
      ...row,
      usernameVersion: version,
      replayKeyHash: null,
      replayUsername: null,
      replayFingerprint: null,
      replayChangedAt: null,
      replayExpiresAt: null,
    })
    return json({ data }, 200, { ETag: etagForVersion(version) })
  } catch {
    return error(503, 'SERVICE_UNAVAILABLE', 'Username state unavailable')
  }
}

export async function handleUsernameChangeRequest(env: BetterAuthEnv, request: Request, now = new Date()): Promise<Response> {
  if (!callerAllowed(request)) return error(403, 'FORBIDDEN', 'Authorized W01 service boundary required')
  const auth = await authenticate(env, request)
  if (!auth.ok) return auth.response

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) return error(428, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key is required')
  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  const versionMatch = ifMatch.match(ETAG_PATTERN)
  if (!versionMatch) return error(428, 'PRECONDITION_REQUIRED', 'A username If-Match ETag is required')
  const expectedVersion = Number(versionMatch[1])
  if (!Number.isSafeInteger(expectedVersion)) return error(400, 'VALIDATION_FAILED', 'Invalid username version')

  let body: unknown
  try { body = await request.json() } catch { return error(422, 'VALIDATION_FAILED', 'Invalid username request') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error(422, 'VALIDATION_FAILED', 'Invalid username request')
  const input = body as Record<string, unknown>
  if (Object.keys(input).length !== 1 || typeof input.username !== 'string') return error(422, 'VALIDATION_FAILED', 'Only the username field is accepted')
  const candidate = normalizeUsernameCandidate(input.username)
  if (!candidate) return error(422, 'VALIDATION_FAILED', 'Username must be 6–32 ASCII letters or digits')
  if (isReservedUsername(candidate.normalized)) return error(422, 'USERNAME_RESERVED', 'This username is reserved by LuckRead')

  const limited = await enforceWriteLimits(env, request, auth.principal.userId)
  if (limited) return limited

  const idempotencyKeyHash = await hashUsernameIdempotencyKey(idempotencyKey)
  const requestFingerprint = await fingerprintUsernameChange(candidate.display, ifMatch)
  const nowIso = now.toISOString()
  const reservationExpiresAt = new Date(now.getTime() + RESERVATION_MS).toISOString()
  const idempotencyExpiresAt = new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS).toISOString()

  let context: UsernameContext | null
  try { context = await loadContext(env, auth.principal.userId, idempotencyKeyHash, nowIso) }
  catch { return error(503, 'SERVICE_UNAVAILABLE', 'Username service unavailable') }
  if (!context) return error(404, 'NOT_FOUND', 'Username record not found')

  if (context.replayKeyHash) {
    if (context.replayFingerprint !== requestFingerprint) {
      return error(409, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency-Key was already used for a different username change')
    }
    return replayResponse(context, now)
  }
  if (context.accountState !== 'ACTIVE') return error(403, 'ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible for this operation')
  if (typeof context.username !== 'string' || context.username.length === 0) return error(409, 'USERNAME_NOT_SET', 'An existing username is required before it can be changed')
  if (context.usernameVersion !== expectedVersion) {
    return error(412, 'PRECONDITION_FAILED', 'Username changed before this request was applied', undefined, { ETag: etagForVersion(context.usernameVersion) })
  }

  const oldNormalized = context.username.trim().normalize('NFC').toLowerCase()
  if (oldNormalized === candidate.normalized) return error(422, 'USERNAME_UNCHANGED', 'The requested username is already current')

  let canChangeAt: string | null
  try { canChangeAt = cooldownEndsAt(context.lastChangedAt) }
  catch { return error(503, 'SERVICE_UNAVAILABLE', 'Username state is unavailable') }
  if (canChangeAt && Date.parse(canChangeAt) > now.getTime()) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(canChangeAt) - now.getTime()) / 1000))
    return error(409, 'USERNAME_CHANGE_COOLDOWN', 'Username can only be changed once every 30 days', { canChangeAt, retryAfter }, { 'retry-after': String(retryAfter) })
  }

  const updateUser = env.D1_01.prepare(
    'UPDATE "user" SET username = ?, updated_at = ? ' +
    'WHERE id = ? AND username = ? AND account_state = \'ACTIVE\' ' +
    'AND COALESCE((SELECT username_version FROM auth_username_change_state WHERE user_id = ?), 0) = ? ' +
    'AND NOT EXISTS (SELECT 1 FROM auth_username_change_state WHERE previous_username_normalized = ? AND previous_username_expires_at > ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE username_normalized = ? AND user_id <> ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM "user" WHERE lower(username) = ? AND id <> ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM auth_credentials c JOIN auth_identities i ON i.id = c.identity_id ' +
    'WHERE c.kind = \'username\' AND c.active = 1 AND c.normalized_value = ? AND i.user_id <> ?)',
  ).bind(
    candidate.display, nowIso, auth.principal.userId, context.username,
    auth.principal.userId, expectedVersion,
    candidate.normalized, nowIso,
    candidate.normalized, auth.principal.userId, candidate.normalized,
    auth.principal.userId, candidate.normalized, auth.principal.userId,
  )

  const saveState = env.D1_01.prepare(
    'INSERT INTO auth_username_change_state (' +
      'user_id, username_version, last_changed_at, previous_username, previous_username_normalized, ' +
      'previous_username_expires_at, idempotency_key_hash, request_fingerprint, idempotency_expires_at, changed_username' +
    ') SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
    'WHERE EXISTS (SELECT 1 FROM "user" WHERE id = ? AND username = ? AND updated_at = ? AND account_state = \'ACTIVE\') ' +
    'ON CONFLICT(user_id) DO UPDATE SET ' +
      'username_version = excluded.username_version, ' +
      'last_changed_at = excluded.last_changed_at, ' +
      'previous_username = excluded.previous_username, ' +
      'previous_username_normalized = excluded.previous_username_normalized, ' +
      'previous_username_expires_at = excluded.previous_username_expires_at, ' +
      'idempotency_key_hash = excluded.idempotency_key_hash, ' +
      'request_fingerprint = excluded.request_fingerprint, ' +
      'idempotency_expires_at = excluded.idempotency_expires_at, ' +
      'changed_username = excluded.changed_username ' +
    'WHERE auth_username_change_state.username_version = ?',
  ).bind(
    auth.principal.userId, expectedVersion + 1, nowIso,
    context.username, oldNormalized, reservationExpiresAt,
    idempotencyKeyHash, requestFingerprint, idempotencyExpiresAt, candidate.display,
    auth.principal.userId, candidate.display, nowIso, expectedVersion,
  )

  const cleanupExpiredReservations = env.D1_01.prepare(
    'UPDATE auth_username_change_state SET previous_username = NULL, ' +
    'previous_username_normalized = NULL, previous_username_expires_at = NULL ' +
    'WHERE previous_username_expires_at IS NOT NULL AND previous_username_expires_at <= ?',
  ).bind(nowIso)

  try {
    const results = await env.D1_01.batch([cleanupExpiredReservations, updateUser, saveState])
    if (!Array.isArray(results) || results.length !== 3 || results.some(result => result.success !== true)) {
      throw new Error('USERNAME_CHANGE_BATCH_FAILED')
    }
    const updated = Number(results[1].meta?.changes ?? 0)
    const saved = Number(results[2].meta?.changes ?? 0)
    if (updated !== 1 || saved !== 1) {
      const latest = await loadContext(env, auth.principal.userId, idempotencyKeyHash, nowIso)
      if (latest?.replayKeyHash && latest.replayFingerprint === requestFingerprint) return replayResponse(latest, now)
      return error(412, 'PRECONDITION_FAILED', 'Username changed before this request was applied', undefined, latest ? { ETag: etagForVersion(latest.usernameVersion) } : undefined)
    }
  } catch (failure) {
    const latest = await loadContext(env, auth.principal.userId, idempotencyKeyHash, nowIso).catch(() => null)
    if (latest?.replayKeyHash && latest.replayFingerprint === requestFingerprint) return replayResponse(latest, now)
    const message = failure instanceof Error ? failure.message : ''
    if (/UNIQUE constraint failed|constraint failed|USERNAME_RESERVED/i.test(message)) {
      return error(409, 'USERNAME_UNAVAILABLE', 'This username is unavailable')
    }
    return error(503, 'SERVICE_UNAVAILABLE', 'Username change could not be committed')
  }

  return json({
    data: {
      username: candidate.display,
      usernameVersion: expectedVersion + 1,
      changedAt: nowIso,
      canChangeAt: new Date(now.getTime() + COOLDOWN_MS).toISOString(),
      previousUsernameReservedUntil: reservationExpiresAt,
    },
    meta: { idempotentReplay: false },
  }, 200, { ETag: etagForVersion(expectedVersion + 1) })
}
