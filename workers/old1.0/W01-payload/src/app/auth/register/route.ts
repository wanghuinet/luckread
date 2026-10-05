import {
  registerWithBetterAuth,
  W02AuthClientError,
} from '../../../auth/w02-session-client.js'
import {
  enforceAuthRateLimit,
  TrafficLimitError,
  rateLimitResponse,
} from '../../../auth/traffic-limit.js'

type RegistrationRequest = {
  identityType?: unknown
  identity?: unknown
  credential?: unknown
  username?: unknown
  consent?: unknown
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
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
  headers: HeadersInit = {},
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export async function POST(request: Request): Promise<Response> {
  try {
    const clientIp = request.headers.get('cf-connecting-ip')?.trim() || 'unknown'
    await enforceAuthRateLimit(request, 'AUTH_REGISTER_LIMITER', ['ip:' + clientIp])
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    return errorResponse(
      503,
      'SERVICE_UNAVAILABLE',
      'Registration service unavailable',
    )
  }

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 255) {
    return errorResponse(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency-Key is required',
    )
  }

  let body: RegistrationRequest
  try {
    body = (await request.json()) as RegistrationRequest
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  if (
    !isRecord(body) ||
    body.identityType !== 'email' ||
    typeof body.identity !== 'string' ||
    body.identity.trim().length === 0 ||
    body.identity.length > 320 ||
    typeof body.credential !== 'string' ||
    body.credential.length === 0 ||
    body.credential.length > 128 ||
    typeof body.username !== 'string' ||
    body.username.trim().length === 0 ||
    body.username.length > 128 ||
    !isRecord(body.consent) ||
    body.consent.purpose !== 'ACCOUNT_REGISTRATION' ||
    typeof body.consent.policyVersion !== 'string' ||
    body.consent.policyVersion.length === 0 ||
    Object.keys(body.consent).some(
      (key) => !['purpose', 'policyVersion'].includes(key),
    )
  ) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid registration request')
  }

  try {
    const result = await registerWithBetterAuth({
      identityType: 'email',
      identity: body.identity,
      credential: body.credential,
      username: body.username,
      consent: {
        purpose: 'ACCOUNT_REGISTRATION',
        policyVersion: body.consent.policyVersion,
      },
      idempotencyKey,
    })

    return json(result, 201)
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      const code =
        error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
          ? 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
          : error.code === 'IDEMPOTENCY_IN_PROGRESS'
            ? 'IDEMPOTENCY_IN_PROGRESS'
            : error.code === 'REGISTRATION_RETRY_REQUIRED'
              ? 'REGISTRATION_RETRY_REQUIRED'
              : error.code === 'IDEMPOTENCY_KEY_REQUIRED'
                ? 'IDEMPOTENCY_KEY_REQUIRED'
                : error.status === 422 || error.status === 400
                  ? 'VALIDATION_FAILED'
                  : 'SERVICE_UNAVAILABLE'
      const headers =
        error.status === 409 ? { 'retry-after': '1' } : {}
      return errorResponse(
        error.status,
        code,
        code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
          ? 'Idempotency key cannot be reused with different input'
          : code === 'IDEMPOTENCY_IN_PROGRESS'
            ? 'A registration with this Idempotency-Key is already in progress'
            : code === 'REGISTRATION_RETRY_REQUIRED'
              ? 'The prior registration attempt is not replayable'
              : code === 'IDEMPOTENCY_KEY_REQUIRED'
                ? 'Idempotency-Key is required'
                : error.status === 422
                  ? 'Registration could not be completed'
                  : error.status === 400
                    ? 'Invalid registration request'
                    : 'Registration service unavailable',
        headers,
      )
    }

    return errorResponse(
      503,
      'SERVICE_UNAVAILABLE',
      'Registration service unavailable',
    )
  }
}
