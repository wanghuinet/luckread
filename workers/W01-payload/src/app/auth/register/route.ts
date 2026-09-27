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
  id: string | number
  payloadHash: string
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  committedResponse?: string | null
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

const errorResponse = (
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
) =>
  json(
    {
      error: {
        code,
        message,
        details: {},
      },
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

const normalizePayloadForHash = (body: {
  identityType: string
  identity: string
  credential: string
  username: string
  consent: { purpose: string; policyVersion: string }
}) =>
  JSON.stringify(
    canonicalize({
      identityType: body.identityType,
      identity: body.identity,
      credential: body.credential,
      username: body.username,
      consent: body.consent,
    }),
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const getExistingEnvelope = async (
  payload: Awaited<ReturnType<typeof getPayload>>,
  idempotencyKey: string,
): Promise<ExistingEnvelope | null> => {
  const result = await payload.find({
    collection: 'auth-registration-envelopes',
    where: {
      and: [
        { idempotencyKey: { equals: idempotencyKey } },
        { scope: { equals: SCOPE } },
        { endpoint: { equals: ENDPOINT } },
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
  })
  return (result.docs[0] as unknown as ExistingEnvelope | undefined) ?? null
}

const isExpired = (expiresAt: string, now: Date) => {
  const expires = Date.parse(expiresAt)
  return !Number.isFinite(expires) || expires <= now.getTime()
}

const parseCommittedResponse = (raw: string | null | undefined): RegistrationResponse | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<RegistrationResponse>
    if (typeof parsed.userId === 'string' && parsed.accountState === ACCOUNT_STATE) {
      return {
        userId: parsed.userId,
        accountState: ACCOUNT_STATE,
      }
    }
  } catch {
    // Fail closed below.
  }
  return null
}

const isUniqueConstraintError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /unique constraint|unique constraint failed|duplicate/i.test(message)
}

const validatePolicy = (now: Date) => {
  if (
    priv004Policy.status !== 'APPROVED' ||
    priv004Policy.environment !== 'DEVELOPMENT' ||
    priv004Policy.usage.productionUse !== false ||
    priv004Policy.rule.mode !== 'DURATION' ||
    !Number.isSafeInteger(priv004Policy.rule.durationSeconds) ||
    priv004Policy.rule.durationSeconds <= 0 ||
    priv004Policy.scope.operationId !== ENDPOINT ||
    priv004Policy.scope.purpose !== SCOPE
  ) {
    throw new Error('PRIV-004 development policy is unavailable or invalid')
  }

  const effectiveFrom = Date.parse(priv004Policy.effectiveFrom)
  const effectiveTo = Date.parse(priv004Policy.effectiveTo)
  if (
    !Number.isFinite(effectiveFrom) ||
    !Number.isFinite(effectiveTo) ||
    now.getTime() < effectiveFrom ||
    now.getTime() > effectiveTo
  ) {
    throw new Error('PRIV-004 development policy is outside its effective window')
  }

  return {
    policyVersion: priv004Policy.policyVersion,
    retentionClass: 'LEGAL_AUDIT' as const,
    retentionUntil: new Date(now.getTime() + priv004Policy.rule.durationSeconds * 1000).toISOString(),
    sourceAuthority: priv004Policy.sourceAuthority,
  }
}

const classifyExisting = async (
  payload: Awaited<ReturnType<typeof getPayload>>,
  existing: ExistingEnvelope,
  payloadHash: string,
  now: Date,
): Promise<Response | null> => {
  if (!isExpired(existing.expiresAt, now)) {
    if (existing.payloadHash !== payloadHash) {
      return errorResponse(
        422,
        'IDEMPOTENCY_KEY_REUSE_CONFLICT',
        'Idempotency key cannot be reused with a different request',
      )
    }

    if (existing.state === 'COMPLETED') {
      const replay = parseCommittedResponse(existing.committedResponse)
      if (!replay) {
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration replay record is unavailable')
      }
      return json(replay, 201)
    }

    if (existing.state === 'IN_PROGRESS') {
      return errorResponse(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'A registration with this Idempotency-Key is already in progress',
        { 'retry-after': '1' },
      )
    }

    return errorResponse(409, 'REGISTRATION_RETRY_REQUIRED', 'The prior registration attempt is not replayable')
  }

  return null
}

export async function POST(request: Request): Promise<Response> {
  const idempotencyKey = request.headers.get('Idempotency-Key')
  if (!idempotencyKey || idempotencyKey.length === 0 || idempotencyKey.length > 255) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (!isRecord(rawBody)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
  }

  const body: AuthRegisterRequest = rawBody
  if (
    body.identityType !== 'email' ||
    typeof body.identity !== 'string' ||
    body.identity.length === 0 ||
    typeof body.credential !== 'string' ||
    body.credential.length === 0 ||
    typeof body.username !== 'string' ||
    body.username.length === 0 ||
    !isRecord(body.consent) ||
    body.consent.purpose !== 'ACCOUNT_REGISTRATION' ||
    typeof body.consent.policyVersion !== 'string' ||
    body.consent.policyVersion.length === 0 ||
    Object.keys(body.consent).some((key) => !['purpose', 'policyVersion'].includes(key))
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const normalized = {
    identityType: body.identityType,
    identity: body.identity,
    credential: body.credential,
    username: body.username,
    consent: {
      purpose: body.consent.purpose as 'ACCOUNT_REGISTRATION',
      policyVersion: body.consent.policyVersion,
    },
  }

  let policy: ReturnType<typeof validatePolicy>
  try {
    policy = validatePolicy(new Date())
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration policy is unavailable')
  }

  if (normalized.consent.policyVersion !== policy.policyVersion) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Consent policyVersion is not admitted for registration')
  }

  const now = new Date()
  const payloadHash = await sha256Hex(normalizePayloadForHash(normalized))
  const payload = await getPayload({ config })

  let existing = await getExistingEnvelope(payload, idempotencyKey)
  const replay = existing ? await classifyExisting(payload, existing, payloadHash, now) : null
  if (replay) return replay

  let transactionID: string | number | undefined
  try {
    transactionID = await payload.db.beginTransaction()

    if (existing && isExpired(existing.expiresAt, now)) {
      await payload.delete({
        collection: 'auth-registration-envelopes',
        id: existing.id,
        overrideAccess: true,
        req: { transactionID },
      })
    }

    let envelope
    try {
      envelope = await payload.create({
        collection: 'auth-registration-envelopes',
        data: {
          idempotencyKey,
          scope: SCOPE,
          endpoint: ENDPOINT,
          payloadHash,
          state: 'IN_PROGRESS',
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
        },
        overrideAccess: true,
        req: { transactionID },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      await payload.db.rollbackTransaction(transactionID)
      transactionID = undefined
      existing = await getExistingEnvelope(payload, idempotencyKey)
      if (!existing) return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration idempotency state is unavailable')
      return (await classifyExisting(payload, existing, payloadHash, new Date())) ??
        errorResponse(409, 'IDEMPOTENCY_IN_PROGRESS', 'A registration with this Idempotency-Key is already in progress', {
          'retry-after': '1',
        })
    }

    const user = await payload.create({
      collection: 'users',
      data: {
        email: normalized.identity,
        password: normalized.credential,
        username: normalized.username,
      },
      req: { transactionID },
    })

    const userId = String(user.id)
    const accountState: RegistrationResponse = {
      userId,
      accountState: ACCOUNT_STATE,
    }

    const consent = await payload.create({
      collection: 'consents',
      data: {
        actorSubjectId: userId,
        ownerSubjectId: userId,
        resourceId: userId,
        resourceType: 'User',
        purpose: 'ACCOUNT_REGISTRATION',
        state: 'GRANTED',
        policyVersion: policy.policyVersion,
        legalBasis: 'CONSENT',
        retentionClass: policy.retentionClass,
        retentionUntil: policy.retentionUntil,
        sourceAuthority: policy.sourceAuthority,
      },
      overrideAccess: true,
      req: { transactionID },
    })

    const responseDigest = await sha256Hex(JSON.stringify(accountState))

    await payload.update({
      collection: 'auth-registration-envelopes',
      id: envelope.id,
      data: {
        state: 'COMPLETED',
        responseDigest,
        committedResponse: JSON.stringify(accountState),
        consentRecordId: String(consent.id),
      },
      overrideAccess: true,
      req: { transactionID },
    })

    await payload.db.commitTransaction(transactionID)
    transactionID = undefined

    return json(accountState, 201)
  } catch (error) {
    if (transactionID !== undefined) {
      try {
        await payload.db.rollbackTransaction(transactionID)
      } catch {
        // Preserve the original failure.
      }
    }

    if (isUniqueConstraintError(error)) {
      return errorResponse(409, 'REGISTRATION_CONFLICT', 'Registration could not be completed')
    }

    console.error(
      JSON.stringify({
        event: 'auth.register.runtime_failure',
        diagnosticCode: 'AUTH001_REGISTRATION_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }
}
