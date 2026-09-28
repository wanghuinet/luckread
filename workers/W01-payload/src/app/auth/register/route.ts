import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getPayload } from 'payload'

import config from '@payload-config'
import priv004Policy from '../../../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
const ACCOUNT_STATE = 'PENDING_VERIFICATION'
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000

type AuthRegisterRequest = {
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

type ExistingEnvelope = {
  id: string
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse?: { userId?: unknown; accountState?: unknown } | null
  expiresAt: string
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  })

const errorResponse = (status: number, code: string, message: string, headers: Record<string, string> = {}) =>
  json(
    {
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    },
    status,
    headers,
  )

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isExpired = (expiresAt: string, now: Date) => {
  const value = Date.parse(expiresAt)
  return !Number.isFinite(value) || value <= now.getTime()
}

const getExistingEnvelope = async (payload: Awaited<ReturnType<typeof getPayload>>, idempotencyKey: string) => {
  const result = await payload.find({
    collection: 'auth-registration-envelopes',
    where: {
      and: [
        { idempotencyKey: { equals: idempotencyKey } },
        { scope: { equals: SCOPE } },
        { endpoint: { equals: ENDPOINT } },
      ],
    },
    sort: '-createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return (result.docs[0] as ExistingEnvelope | undefined) ?? null
}

const parseReplay = (value: ExistingEnvelope['committedResponse']): RegistrationResponse | null => {
  if (!value || typeof value.userId !== 'string' || value.accountState !== ACCOUNT_STATE) return null
  return { userId: value.userId, accountState: ACCOUNT_STATE }
}

const isUniqueConstraintError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint|unique constraint failed|duplicate/i.test(message)
}

const validatePolicy = (now: Date) => {
  const runtimeEnvironment = process.env.CLOUDFLARE_ENV ?? (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  if (
    runtimeEnvironment.toLowerCase() === 'production' ||
    priv004Policy.status !== 'APPROVED' ||
    priv004Policy.environment !== 'DEVELOPMENT' ||
    priv004Policy.usage.productionUse !== false ||
    priv004Policy.rule.mode !== 'DURATION' ||
    !Number.isSafeInteger(priv004Policy.rule.durationSeconds) ||
    priv004Policy.rule.durationSeconds <= 0 ||
    priv004Policy.scope.operationId !== ENDPOINT ||
    priv004Policy.scope.purpose !== SCOPE
  ) throw new Error('PRIV004_POLICY_NOT_ADMISSIBLE')

  const effectiveFrom = Date.parse(priv004Policy.effectiveFrom)
  const effectiveTo = Date.parse(priv004Policy.effectiveTo)
  if (!Number.isFinite(effectiveFrom) || !Number.isFinite(effectiveTo) || now.getTime() < effectiveFrom || now.getTime() > effectiveTo) {
    throw new Error('PRIV004_POLICY_OUTSIDE_WINDOW')
  }

  return {
    policyVersion: priv004Policy.policyVersion,
    retentionClass: 'LEGAL_AUDIT' as const,
    retentionUntil: new Date(now.getTime() + priv004Policy.rule.durationSeconds * 1000).toISOString(),
    sourceAuthority: priv004Policy.sourceAuthority,
  }
}

export async function POST(request: Request): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 255) return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')

  let body: unknown
  try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
  if (!isRecord(body) || !isRecord(body.consent)) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')

  const identityType = body.identityType
  const identity = body.identity
  const credential = body.credential
  const username = body.username
  const consent = body.consent
  if (
    identityType !== 'email' ||
    typeof identity !== 'string' || identity.trim().length === 0 ||
    typeof credential !== 'string' || credential.length === 0 ||
    typeof username !== 'string' || username.trim().length === 0 || username.length > 128 ||
    consent.purpose !== SCOPE ||
    typeof consent.policyVersion !== 'string' || consent.policyVersion.length === 0 ||
    Object.keys(consent).some((key) => !['purpose', 'policyVersion'].includes(key))
  ) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')

  const now = new Date()
  let policy: ReturnType<typeof validatePolicy>
  try { policy = validatePolicy(now) } catch { return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration policy is unavailable') }
  if (consent.policyVersion !== policy.policyVersion) return errorResponse(422, 'VALIDATION_FAILED', 'Consent policyVersion is not admitted for registration')

  const normalized = {
    identityType: 'email',
    identity: identity.trim().toLowerCase(),
    credential,
    username: username.trim(),
    consent: { purpose: SCOPE, policyVersion: consent.policyVersion },
  }
  const payloadHash = await sha256Hex(JSON.stringify(canonicalize(normalized)))
  const payload = await getPayload({ config })
  const existing = await getExistingEnvelope(payload, idempotencyKey)

  if (existing && !isExpired(existing.expiresAt, now)) {
    if (existing.payloadHash !== payloadHash) return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
    if (existing.state === 'IN_PROGRESS') return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
    if (existing.state === 'COMPLETED') {
      const replay = parseReplay(existing.committedResponse)
      return replay ? json(replay, 201) : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
    }
    return errorResponse(409, 'REGISTRATION_RETRY_REQUIRED', 'The prior registration attempt is not replayable')
  }

  let transactionID: string | number | undefined
  try {
    transactionID = await payload.db.beginTransaction()

    if (existing && isExpired(existing.expiresAt, now)) {
      await payload.update({
        collection: 'auth-registration-envelopes',
        id: existing.id,
        data: { activeKey: null },
        overrideAccess: true,
        req: { transactionID },
      })
    }

    let envelope
    try {
      envelope = await payload.create({
        collection: 'auth-registration-envelopes',
        data: {
          id: crypto.randomUUID(),
          idempotencyKey,
          activeKey: idempotencyKey,
          scope: SCOPE,
          endpoint: ENDPOINT,
          payloadHash,
          state: 'IN_PROGRESS',
          committedResponse: {},
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
        },
        overrideAccess: true,
        req: { transactionID },
        depth: 0,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      await payload.db.rollbackTransaction(transactionID)
      transactionID = undefined
      const winner = await getExistingEnvelope(payload, idempotencyKey)
      if (!winner) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration idempotency state is unavailable')
      if (winner.payloadHash !== payloadHash) return errorResponse(422, 'IDEMPOTENCY_KEY_REUSE_CONFLICT', 'Idempotency key cannot be reused with different input')
      if (winner.state === 'COMPLETED') {
        const replay = parseReplay(winner.committedResponse)
        return replay ? json(replay, 201) : errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
      }
      return errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', { 'retry-after': '1' })
    }

    const user = await payload.create({
      collection: 'users',
      data: { email: normalized.identity, password: normalized.credential, username: normalized.username },
      overrideAccess: true,
      req: { transactionID },
      depth: 0,
    })

    const responseBody: RegistrationResponse = { userId: String(user.id), accountState: ACCOUNT_STATE }
    const consent = await payload.create({
      collection: 'consents',
      data: {
        id: crypto.randomUUID(),
        actorSubjectId: responseBody.userId,
        ownerSubjectId: responseBody.userId,
        resourceId: responseBody.userId,
        resourceType: 'User',
        purpose: SCOPE,
        state: 'GRANTED',
        policyVersion: policy.policyVersion,
        legalBasis: 'CONSENT',
        retentionClass: policy.retentionClass,
        retentionUntil: policy.retentionUntil,
        sourceAuthority: policy.sourceAuthority,
      },
      overrideAccess: true,
      req: { transactionID },
      depth: 0,
    })

    const responseDigest = await sha256Hex(JSON.stringify(responseBody))
    await payload.update({
      collection: 'auth-registration-envelopes',
      id: envelope.id,
      data: {
        state: 'COMPLETED',
        responseDigest,
        committedResponse: responseBody,
        consentRecordId: String(consent.id),
      },
      overrideAccess: true,
      req: { transactionID },
      depth: 0,
    })

    await payload.db.commitTransaction(transactionID)
    transactionID = undefined

    try {
      const { env } = await getCloudflareContext({ async: true })
      const row = await env.D1.prepare('SELECT account_state, account_state_version FROM users WHERE id = ? LIMIT 1').bind(String(user.id)).first<{ account_state: string; account_state_version: number }>()
      if (row?.account_state !== ACCOUNT_STATE || row.account_state_version !== 1) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration state could not be verified')
    } catch {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration state could not be verified')
    }

    return json(responseBody, 201)
  } catch (error) {
    if (transactionID !== undefined) {
      try { await payload.db.rollbackTransaction(transactionID) } catch {}
    }
    console.error(JSON.stringify({ event: 'auth.register.runtime_failure', diagnosticCode: 'AUTH001_REGISTRATION_FAILURE', errorName: error instanceof Error ? error.name : typeof error }))
    if (isUniqueConstraintError(error)) return errorResponse(422, 'VALIDATION_FAILED', 'Registration could not be completed')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }
}