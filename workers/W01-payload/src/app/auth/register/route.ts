import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import { callW02BetterAuth } from '../../../auth/w02-auth-client.js'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
const ACCOUNT_STATE = 'PENDING_VERIFICATION'
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

type RegistrationBody = {
  identityType?: unknown
  identity?: unknown
  credential?: unknown
  username?: unknown
  consent?: unknown
}

type RegistrationResponse = {
  userId: string
  accountState: typeof ACCOUNT_STATE
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const errorResponse = (status: number, code: string, message: string, extraHeaders: Record<string, string> = {}) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    {
      status,
      headers: { 'cache-control': 'no-store', ...extraHeaders },
    },
  )

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers },
  })

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const getDb = async () => (await getCloudflareContext({ async: true })).env.D1

const getEnvelope = async (db: D1Database, key: string) =>
  db.prepare(
    `SELECT id, payload_hash AS payloadHash, state, committed_response AS committedResponse, expires_at AS expiresAt
       FROM auth_registration_envelopes
      WHERE idempotency_key = ? AND scope = ? AND endpoint = ?
      ORDER BY created_at DESC LIMIT 1`,
  ).bind(key, SCOPE, ENDPOINT).first<{
    id: string
    payloadHash: string
    state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
    committedResponse: string | null
    expiresAt: string
  }>()

const parseCommitted = (value: string | null): RegistrationResponse | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (typeof parsed.userId !== 'string' || parsed.accountState !== ACCOUNT_STATE) return null
    return { userId: parsed.userId, accountState: ACCOUNT_STATE }
  } catch {
    return null
  }
}

const nativeUserByEmail = async (db: D1Database, email: string) =>
  db.prepare(
    `SELECT id, email, username, name, account_state AS accountState, account_state_version AS accountStateVersion
       FROM "user" WHERE email = ? LIMIT 1`,
  ).bind(email).first<{
    id: string
    email: string
    username: string | null
    name: string
    accountState: string
    accountStateVersion: number
  }>()

const ensurePayloadProjection = async (
  payload: Awaited<ReturnType<typeof getPayload>>,
  nativeUser: { id: string; email: string; username: string | null; name: string },
): Promise<void> => {
  const existingByIdentity = await payload.find({
    collection: 'users',
    where: { identityUserId: { equals: nativeUser.id } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existingByIdentity.docs.length > 0) return

  const existingByEmail = await payload.find({
    collection: 'users',
    where: { email: { equals: nativeUser.email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const existing = existingByEmail.docs[0] as unknown as { id?: string | number } | undefined

  if (existing?.id) {
    await payload.update({
      collection: 'users',
      id: existing.id,
      data: { identityUserId: nativeUser.id },
      overrideAccess: true,
      depth: 0,
    })
    return
  }

  await payload.create({
    collection: 'users',
    data: {
      email: nativeUser.email,
      username: nativeUser.username?.trim() || nativeUser.name,
      displayName: nativeUser.name,
      identityUserId: nativeUser.id,
    },
    overrideAccess: true,
    disableTransaction: true,
  })
}

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REGISTER_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  let body: RegistrationBody
  try {
    body = await request.json() as RegistrationBody
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (!isRecord(body.consent)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const identity = typeof body.identity === 'string' ? body.identity.trim().toLowerCase() : ''
  const credential = typeof body.credential === 'string' ? body.credential : ''
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  if (
    body.identityType !== 'email' ||
    !identity ||
    credential.length < 15 ||
    credential.length > 128 ||
    !username ||
    username.length > 128 ||
    body.consent.purpose !== SCOPE ||
    typeof body.consent.policyVersion !== 'string' ||
    !body.consent.policyVersion
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const db = await getDb()
  const normalized = {
    identityType: 'email',
    identity,
    credential,
    username,
    consent: {
      purpose: SCOPE,
      policyVersion: body.consent.policyVersion,
    },
  }
  const payloadHash = await sha256Hex(JSON.stringify(canonicalize(normalized)))
  const now = new Date()
  const existing = await getEnvelope(db, idempotencyKey)

  if (existing && Date.parse(existing.expiresAt) > now.getTime()) {
    if (existing.payloadHash !== payloadHash) {
      return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
    }
    if (existing.state === 'IN_PROGRESS') {
      return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
    }
    if (existing.state === 'COMPLETED') {
      const replay = parseCommitted(existing.committedResponse)
      return replay ? json(replay, 201) : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
    }
  }

  const envelopeId = crypto.randomUUID()
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  try {
    await db.prepare(
      `INSERT INTO auth_registration_envelopes
        (id, idempotency_key, active_key, scope, endpoint, payload_hash, state, expires_at, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?)`,
    ).bind(
      envelopeId,
      idempotencyKey,
      idempotencyKey,
      SCOPE,
      ENDPOINT,
      payloadHash,
      expiresAt,
      now.toISOString(),
      now.toISOString(),
    ).run()
  } catch (error) {
    const current = await getEnvelope(db, idempotencyKey)
    if (current && current.payloadHash === payloadHash && current.state === 'COMPLETED') {
      const replay = parseCommitted(current.committedResponse)
      return replay ? json(replay, 201) : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
    }
    return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
  }

  let authResponse: Response
  let nativeUser: { id: string; email: string; username: string | null; name: string } | null = null

  try {
    authResponse = await callW02BetterAuth(request, '/api/auth/sign-up/email', {
      method: 'POST',
      body: {
        name: username,
        email: identity,
        password: credential,
        username,
      },
    })

    let authBody: unknown = null
    try {
      authBody = await authResponse.clone().json()
    } catch {
      authBody = null
    }

    const candidateUser = isRecord(authBody) && isRecord(authBody.user) ? authBody.user : null
    const candidateUserId = candidateUser && typeof candidateUser.id === 'string' ? candidateUser.id : null
    nativeUser =
      candidateUserId
        ? {
            id: candidateUserId,
            email: identity,
            username,
            name: username,
          }
        : await nativeUserByEmail(db, identity)

    if (!nativeUser) {
      await db.prepare(
        `UPDATE auth_registration_envelopes SET state = 'FAILED', updated_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), envelopeId).run()
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service did not return a usable account')
    }

    if (!authResponse.ok && authResponse.status !== 200 && authResponse.status !== 201) {
      await db.prepare(
        `UPDATE auth_registration_envelopes SET state = 'FAILED', updated_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), envelopeId).run()
      const status = authResponse.status === 400 || authResponse.status === 422 || authResponse.status === 409 ? 422 : 503
      return errorResponse(status, status === 422 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE', status === 422 ? 'Registration could not be completed' : 'Registration service unavailable')
    }

    const payload = await getPayload({ config })
    await ensurePayloadProjection(payload, nativeUser)

    const consentRecordId = crypto.randomUUID()
    await db.prepare(
      `INSERT INTO consents
        (id, actor_subject_id, owner_subject_id, resource_id, resource_type, purpose, state, policy_version, legal_basis, retention_class, retention_until, source_authority)
       VALUES (?, ?, ?, ?, 'User', ?, 'GRANTED', ?, 'CONSENT', 'LEGAL_AUDIT', ?, 'W01')`,
    ).bind(
      consentRecordId,
      nativeUser.id,
      nativeUser.id,
      nativeUser.id,
      SCOPE,
      body.consent.policyVersion,
      expiresAt,
    ).run()

    const responseBody: RegistrationResponse = {
      userId: nativeUser.id,
      accountState: ACCOUNT_STATE,
    }

    await db.prepare(
      `UPDATE auth_registration_envelopes
          SET state = 'COMPLETED', committed_response = ?, consent_record_id = ?, updated_at = ?
        WHERE id = ? AND state = 'IN_PROGRESS'`,
    ).bind(
      JSON.stringify(responseBody),
      consentRecordId,
      new Date().toISOString(),
      envelopeId,
    ).run()

    const headers: Record<string, string> = {}
    const setCookie = authResponse.headers.get('set-cookie')
    if (setCookie) headers['set-cookie'] = setCookie
    return json(responseBody, 201, headers)
  } catch (error) {
    await db.prepare(
      `UPDATE auth_registration_envelopes SET state = 'FAILED', updated_at = ? WHERE id = ? AND state = 'IN_PROGRESS'`,
    ).bind(new Date().toISOString(), envelopeId).run()
    if (error instanceof Error && /unique|already exists|duplicate/i.test(error.message)) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Registration identity is already in use')
    }
    console.error(JSON.stringify({
      event: 'auth.register.better_auth_failure',
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }
}
