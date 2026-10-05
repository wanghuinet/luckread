import priv004DevPolicy from '../../../../../../artifacts/mapping-0/priv004-approved-policy-instance-2026-09-27.json'
import priv004ProdPolicy from '../../../../../../artifacts/mapping-0/priv004-production-policy-instance-2026-09-27.json'
import { enforceAuthRateLimit, TrafficLimitError, rateLimitResponse } from '../../../auth/traffic-limit.js'
import { registerWithBetterAuth, W02AuthClientError } from '../../../auth/w02-session-client.js'
// AUTH-001 boundary: W01 is the public edge; W02 / Better Auth owns identity registration persistence.

const SCOPE = 'ACCOUNT_REGISTRATION'
const ENDPOINT = 'authRegister'
const ACCOUNT_STATE = 'PENDING_VERIFICATION'

type RegistrationRequest = {
  identityType?: unknown
  identity?: unknown
  credential?: unknown
  username?: unknown
  consent?: unknown
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

const validatePolicy = (now: Date) => {
  const runtimeEnvironment =
    process.env.CLOUDFLARE_ENV ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development')
  const priv004Policy =
    runtimeEnvironment.toLowerCase() === 'production'
      ? priv004ProdPolicy
      : priv004DevPolicy

  if (
    priv004Policy.status !== 'APPROVED' ||
    (runtimeEnvironment.toLowerCase() === 'production'
      ? priv004Policy.environment !== 'PRODUCTION' || priv004Policy.usage.productionUse !== true
      : priv004Policy.environment !== 'DEVELOPMENT' || priv004Policy.usage.productionUse !== false) ||
    priv004Policy.rule.mode !== 'DURATION' ||
    !Number.isSafeInteger(priv004Policy.rule.durationSeconds) ||
    priv004Policy.rule.durationSeconds <= 0 ||
    priv004Policy.scope.operationId !== ENDPOINT ||
    priv004Policy.scope.purpose !== SCOPE
  ) {
    throw new Error('PRIV004_POLICY_NOT_ADMISSIBLE')
  }

  const effectiveFrom = Date.parse(priv004Policy.effectiveFrom)
  const effectiveTo =
    priv004Policy.effectiveTo === null
      ? Number.POSITIVE_INFINITY
      : Date.parse(priv004Policy.effectiveTo)

  if (
    !Number.isFinite(effectiveFrom) ||
    (!Number.isFinite(effectiveTo) && effectiveTo !== Number.POSITIVE_INFINITY) ||
    now.getTime() < effectiveFrom ||
    now.getTime() > effectiveTo
  ) {
    throw new Error('PRIV004_POLICY_OUTSIDE_WINDOW')
  }

  return {
    policyVersion: priv004Policy.policyVersion,
    retentionUntil: new Date(
      now.getTime() + priv004Policy.rule.durationSeconds * 1000,
    ).toISOString(),
    sourceAuthority: priv004Policy.sourceAuthority,
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REGISTER_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    console.error(
      JSON.stringify({
        event: 'auth.register.w01_rate_limit_failure',
        diagnosticCode: 'AUTH001_W01_RATE_LIMIT_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
      }),
    )
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration service unavailable')
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (!isRecord(body) || !isRecord(body.consent)) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const input = body as RegistrationRequest
  const identityType = input.identityType
  const identity = input.identity
  const credential = input.credential
  const username = input.username
  const consent = input.consent as Record<string, unknown>

  if (
    identityType !== 'email' ||
    typeof identity !== 'string' ||
    identity.trim().length === 0 ||
    typeof credential !== 'string' ||
    credential.length === 0 ||
    typeof username !== 'string' ||
    username.trim().length === 0 ||
    username.length > 128 ||
    consent.purpose !== SCOPE ||
    typeof consent.policyVersion !== 'string' ||
    consent.policyVersion.length === 0 ||
    Object.keys(consent).some((key) => !['purpose', 'policyVersion'].includes(key))
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  const now = new Date()

  let policy: ReturnType<typeof validatePolicy>
  try {
    policy = validatePolicy(now)
  } catch {
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Registration policy is unavailable')
  }

  if (consent.policyVersion !== policy.policyVersion) {
    return errorResponse(
      422,
      'VALIDATION_FAILED',
      'Consent policyVersion is not admitted for registration',
    )
  }

  const normalized = {
    identityType: 'email',
    identity: identity.trim().toLowerCase(),
    credential,
    username: username.trim(),
    consent: {
      purpose: SCOPE,
      policyVersion: consent.policyVersion,
    },
  }

  const payloadHash = await sha256Hex(
    JSON.stringify(canonicalize(normalized)),
  )

  const responseDigest = await sha256Hex(
    JSON.stringify(
      canonicalize({
        schema: 'AUTH-001.response-digest.v1',
        operationId: ENDPOINT,
        endpoint: '/auth/register',
        idempotencyKey,
        payloadHash,
        status: 201,
        accountState: ACCOUNT_STATE,
      }),
    ),
  )

  try {
    const result = await registerWithBetterAuth({
      idempotencyKey,
      payloadHash,
      responseDigest,
      email: normalized.identity,
      password: normalized.credential,
      username: normalized.username,
      policy: {
        policyVersion: policy.policyVersion,
        retentionUntil: policy.retentionUntil,
        sourceAuthority: policy.sourceAuthority,
      },
      now: now.toISOString(),
    })

    return json(result, 201)
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      const code =
        error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ||
        error.code === 'REGISTRATION_CONFLICT' ||
        error.code === 'IDEMPOTENCY_IN_PROGRESS' ||
        error.code === 'REGISTRATION_RETRY_REQUIRED'
          ? error.code
          : error.status === 422 || error.status === 400
            ? 'VALIDATION_FAILED'
            : 'SERVICE_UNAVAILABLE'

      return errorResponse(
        error.status,
        code,
        error.status === 409
          ? 'A registration with this Idempotency-Key is already in progress'
          : error.status === 422
            ? 'Registration could not be completed'
            : error.status === 400
              ? 'Invalid registration request'
              : 'Registration service unavailable',
        error.status === 409 ? { 'retry-after': '1' } : {},
      )
    }

    console.error(
      JSON.stringify({
        event: 'auth.register.w01_bridge_failure',
        diagnosticCode: 'AUTH001_W01_W02_REGISTRATION_BRIDGE_FAILURE',
        errorName: error instanceof Error ? error.name : typeof error,
      }),
    )

    return errorResponse(
      503,
      'SERVICE_UNAVAILABLE',
      'Registration service unavailable',
    )
  }
}
