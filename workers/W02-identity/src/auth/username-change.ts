import usernameReservationPolicy from '../../../../contracts/security/username-reservation-policy.v1.json'
import type { BetterAuthEnv } from './better-auth.js'
import { resolveBetterAuthPrincipal } from './principal.js'

const COOLDOWN_MS = Number(usernameReservationPolicy.ownerDecision.renameCooldownDays) * 24 * 60 * 60 * 1000
const RESERVED_USERNAMES = new Set(usernameReservationPolicy.reservation.reservedUsernames)
const USERNAME_PATTERN = /^[A-Za-z0-9]{6,32}$/
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{16,255}$/
const CORRELATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const ETAG_PATTERN = /^"username-v(0|[1-9][0-9]*)"$/

type UsernameCandidate = { display: string; normalized: string }
type UsernameContext = {
  username: string | null
  accountState: string
  usernameVersion: number
  lastChangedAt: string | null
  replayChangeId: string | null
  replayFingerprint: string | null
  replayUsername: string | null
  replayVersion: number | null
  replayChangedAt: string | null
}

const CONTEXT_SQL = \`
SELECT u.username AS username, u.account_state AS accountState,
       COALESCE(latest.version, 0) AS usernameVersion,
       latest.changed_at AS lastChangedAt,
       replay.change_id AS replayChangeId,
       replay.request_fingerprint AS replayFingerprint,
       replay.new_username AS replayUsername,
       replay.version AS replayVersion,
       replay.changed_at AS replayChangedAt
FROM "user" u
LEFT JOIN auth_username_change_history latest
  ON latest.user_id = u.id
 AND latest.version = (SELECT MAX(version) FROM auth_username_change_history WHERE user_id = u.id)
LEFT JOIN auth_username_change_history replay
  ON replay.user_id = u.id AND replay.idempotency_key_hash = ?
WHERE u.id = ?
LIMIT 1
\`

const STATE_SQL = \`
SELECT u.username AS username, u.account_state AS accountState,
       COALESCE(latest.version, 0) AS usernameVersion,
       latest.changed_at AS lastChangedAt
FROM "user" u
LEFT JOIN auth_username_change_history latest
  ON latest.user_id = u.id
 AND latest.version = (SELECT MAX(version) FROM auth_username_change_history WHERE user_id = u.id)
WHERE u.id = ?
LIMIT 1
\`

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

const safeCorrelationId = (request: Request): string => {
  const supplied = request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  return CORRELATION_PATTERN.test(supplied) ? supplied : 'req_' + crypto.randomUUID()
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
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

async function loadContext(env: BetterAuthEnv, userId: string, idempotencyKeyHash: string): Promise<UsernameContext | null> {
  const row = await env.D1_01.prepare(CONTEXT_SQL).bind(idempotencyKeyHash, userId).first<UsernameContext>()
  return contextFromRow(row)
}

async function authenticate(env: BetterAuthEnv, request: Request) {
  try {
    const principal = await resolveBetterAuthPrincipal(env, request)
    if (!principal) return { response: error(401, 'UNAUTHENTICATED', 'Authentication required') } as const
    if (principal.accountState !== 'ACTIVE') return { response: error(403, 'ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible for this operation') } as const
    return { principal } as const
  } catch {
    return { response: error(503, 'SERVICE_UNAVAILABLE', 'Username service unavailable') } as const
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
  if (!Number.isFinite(timestamp)) throw new Error('USERNAME_HISTORY_TIMESTAMP_INVALID')
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

function replayResponse(context: UsernameContext): Response {
  const changedAt = context.replayChangedAt
  const version = context.replayVersion
  if (!context.replayUsername || !changedAt || !Number.isSafeInteger(Number(version))) {
    return error(503, 'SERVICE_UNAVAILABLE', 'Username idempotency record is invalid')
  }
  return json({
    data: { username: context.replayUsername, usernameVersion: Number(version), changedAt, canChangeAt: cooldownEndsAt(changedAt) },
    meta: { idempotentReplay: true },
  }, 200, { ETag: etagForVersion(Number(version)) })
}

export async function handleUsernameStateRequest(env: BetterAuthEnv, request: Request): Promise<Response> {
  if (!callerAllowed(request)) return error(403, 'FORBIDDEN', 'Authorized W01 service boundary required')
  const auth = await authenticate(env, request)
  if ('response' in auth) return auth.response
  const limited = await enforceReadLimits(env, auth.principal.userId)
  if (limited) return limited

  try {
    const row = await env.D1_01.prepare(STATE_SQL).bind(auth.principal.userId)
      .first<Omit<UsernameContext, 'replayChangeId' | 'replayFingerprint' | 'replayUsername' | 'replayVersion' | 'replayChangedAt'>>()
    if (!row || typeof row.accountState !== 'string') return error(404, 'NOT_FOUND', 'Username record not found')
    if (row.accountState !== 'ACTIVE') return error(403, 'ACCOUNT_NOT_ELIGIBLE', 'Account is not eligible for this operation')
    const version = Number(row.usernameVersion)
    if (!Number.isSafeInteger(version) || version < 0) throw new Error('USERNAME_VERSION_INVALID')
    const data = stateDto({ ...row, usernameVersion: version, replayChangeId: null, replayFingerprint: null, replayUsername: null, replayVersion: null, replayChangedAt: null })
    return json({ data }, 200, { ETag: etagForVersion(version) })
  } catch {
    return error(503, 'SERVICE_UNAVAILABLE', 'Username state unavailable')
  }
}

export async function handleUsernameChangeRequest(env: BetterAuthEnv, request: Request, now = new Date()): Promise<Response> {
  if (!callerAllowed(request)) return error(403, 'FORBIDDEN', 'Authorized W01 service boundary required')
  const auth = await authenticate(env, request)
  if ('response' in auth) return auth.response

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

  const idempotencyKeyHash = await sha256Hex(idempotencyKey)
  const requestFingerprint = await fingerprintUsernameChange(candidate.display, ifMatch)
  const nowIso = now.toISOString()
  const correlationId = safeCorrelationId(request)

  let context: UsernameContext | null
  try { context = await loadContext(env, auth.principal.userId, idempotencyKeyHash) }
  catch { return error(503, 'SERVICE_UNAVAILABLE', 'Username service unavailable') }
  if (!context) return error(404, 'NOT_FOUND', 'Username record not found')

  if (context.replayChangeId) {
    if (context.replayFingerprint !== requestFingerprint) return error(409, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency-Key was already used for a different username change')
    return replayResponse(context)
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
  catch { return error(503, 'SERVICE_UNAVAILABLE', 'Username history is unavailable') }
  if (canChangeAt && Date.parse(canChangeAt) > now.getTime()) {
    const retryAfter = Math.max(1, Math.ceil((Date.parse(canChangeAt) - now.getTime()) / 1000))
    return error(409, 'USERNAME_CHANGE_COOLDOWN', 'Username can only be changed once every 30 days', { canChangeAt, retryAfter }, { 'retry-after': String(retryAfter) })
  }

  const changeId = 'uchg_' + crypto.randomUUID().replaceAll('-', '')
  const nextVersion = expectedVersion + 1
  const updateUser = env.D1_01.prepare(
    'UPDATE "user" SET username = ?, updated_at = ? ' +
    'WHERE id = ? AND username = ? AND account_state = \'ACTIVE\' ' +
    'AND COALESCE((SELECT MAX(version) FROM auth_username_change_history WHERE user_id = ?), 0) = ? ' +
    'AND NOT EXISTS (SELECT 1 FROM auth_username_change_history WHERE username_normalized = ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE username_normalized = ? AND user_id <> ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM "user" WHERE lower(username) = ? AND id <> ?) ' +
    'AND NOT EXISTS (SELECT 1 FROM auth_credentials c JOIN auth_identities i ON i.id = c.identity_id ' +
    'WHERE c.kind = \'username\' AND c.active = 1 AND c.normalized_value = ? AND i.user_id <> ?)',
  ).bind(
    candidate.display, nowIso, auth.principal.userId, context.username,
    auth.principal.userId, expectedVersion, candidate.normalized,
    candidate.normalized, auth.principal.userId, candidate.normalized,
    auth.principal.userId, candidate.normalized, auth.principal.userId,
  )

  const insertHistory = env.D1_01.prepare(
    'INSERT INTO auth_username_change_history (' +
      'change_id, user_id, version, old_username, username_normalized, new_username, ' +
      'new_username_normalized, idempotency_key_hash, request_fingerprint, session_id, correlation_id, changed_at' +
    ') SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
    'WHERE EXISTS (SELECT 1 FROM "user" WHERE id = ? AND username = ? AND updated_at = ? AND account_state = \'ACTIVE\') ' +
    'AND COALESCE((SELECT MAX(version) FROM auth_username_change_history WHERE user_id = ?), 0) = ?',
  ).bind(
    changeId, auth.principal.userId, nextVersion, context.username, oldNormalized,
    candidate.display, candidate.normalized, idempotencyKeyHash, requestFingerprint,
    auth.principal.sessionId, correlationId, nowIso,
    auth.principal.userId, candidate.display, nowIso, auth.principal.userId, expectedVersion,
  )

  try {
    const results = await env.D1_01.batch([updateUser, insertHistory])
    if (!Array.isArray(results) || results.length !== 2 || results.some(result => result.success !== true)) throw new Error('USERNAME_CHANGE_BATCH_FAILED')
    const updated = Number(results[0].meta?.changes ?? 0)
    const recorded = Number(results[1].meta?.changes ?? 0)
    if (updated !== 1 || recorded !== 1) {
      const latest = await loadContext(env, auth.principal.userId, idempotencyKeyHash)
      if (latest?.replayChangeId && latest.replayFingerprint === requestFingerprint) return replayResponse(latest)
      return error(412, 'PRECONDITION_FAILED', 'Username changed before this request was applied', undefined, latest ? { ETag: etagForVersion(latest.usernameVersion) } : undefined)
    }
  } catch (failure) {
    const latest = await loadContext(env, auth.principal.userId, idempotencyKeyHash).catch(() => null)
    if (latest?.replayChangeId && latest.replayFingerprint === requestFingerprint) return replayResponse(latest)
    const message = failure instanceof Error ? failure.message : ''
    if (/UNIQUE constraint failed|constraint failed/i.test(message)) return error(409, 'USERNAME_UNAVAILABLE', 'This username is unavailable')
    return error(503, 'SERVICE_UNAVAILABLE', 'Username change could not be committed')
  }

  return json({
    data: { username: candidate.display, usernameVersion: nextVersion, changedAt: nowIso, canChangeAt: new Date(now.getTime() + COOLDOWN_MS).toISOString() },
    meta: { idempotentReplay: false },
  }, 200, { ETag: etagForVersion(nextVersion) })
}
