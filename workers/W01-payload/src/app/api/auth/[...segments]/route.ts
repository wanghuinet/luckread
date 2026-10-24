import { getCloudflareContext } from '@opennextjs/cloudflare'

import {
  enforceAuthRateLimit,
  TrafficLimitError,
  rateLimitResponse,
} from '@/auth/traffic-limit'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

const errorResponse = (
  status: number,
  code: string,
  message: string,
) =>
  new Response(
    JSON.stringify({
      error: { code, message, details: {} },
      requestId: `req_${crypto.randomUUID()}`,
    }),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  )

const handler = async (
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
) => {
  const { segments = [] } = await context.params
  const endpoint = segments.join('/')

  if (!endpoint) return new Response(null, { status: 404 })

  // Account creation must pass through W01 /auth/register so the
  // idempotency, consent, rate-limit, and Payload projection seams run.
  // Exposing Better Auth sign-up directly would create an identity without
  // the required W01 profile projection.
  const canonicalW01AuthEndpoints = new Set([
    'sign-up/email',
    'send-verification-email',
    'change-password',
    'request-password-reset',
    'reset-password',
  ])

  if (canonicalW01AuthEndpoints.has(endpoint)) {
    return errorResponse(
      404,
      'NOT_FOUND',
      'This authentication operation is not available at this endpoint',
    )
  }

  if (request.method === 'POST' && endpoint === 'sign-in/email') {
    try {
      const clientIp =
        request.headers.get('cf-connecting-ip')?.trim() || 'unknown'

      await enforceAuthRateLimit(
        request,
        'AUTH_LOGIN_LIMITER',
        ['ip:' + clientIp],
      )
    } catch (error) {
      if (error instanceof TrafficLimitError) return rateLimitResponse(request)

      return errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        'Authentication service unavailable',
      )
    }
  }

  try {
    const contextCf = await getCloudflareContext({ async: true })
    const service = (
      contextCf.env as unknown as { W02_AUTH?: W02ServiceBinding }
    ).W02_AUTH

    if (!service) {
      return errorResponse(
        503,
        'SERVICE_UNAVAILABLE',
        'Authentication service unavailable',
      )
    }

    // The MFA plugin challenge is supported for privileged accounts only in
    // this rollout. Require W02 to validate the current session and the
    // persisted effective L5-L8 role before enabling, disabling, or rotating
    // MFA material. Never trust a subject/layer supplied by the caller.
    const privilegedMfaManagementEndpoints = new Set([
      'two-factor/enable',
      'two-factor/disable',
      'two-factor/generate-backup-codes',
      'two-factor/get-totp-uri',
      'totp/generate',
    ])
    if (request.method === 'POST' && privilegedMfaManagementEndpoints.has(endpoint)) {
      const eligibilityHeaders = new Headers(request.headers)
      eligibilityHeaders.delete('host')
      eligibilityHeaders.delete('content-length')
      let eligibilityResponse: Response
      try {
        eligibilityResponse = await service.fetch(new Request(
          'https://luckread-w02.internal/internal/auth/mfa/enrollment-eligibility',
          { method: 'POST', headers: eligibilityHeaders },
        ))
      } catch {
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment eligibility unavailable')
      }
      if (!eligibilityResponse.ok) {
        if (eligibilityResponse.status === 401) {
          return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
        }
        if (eligibilityResponse.status === 403) {
          return errorResponse(403, 'MFA_PRIVILEGED_ROLE_REQUIRED', 'MFA management is available only to privileged accounts')
        }
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'MFA enrollment eligibility unavailable')
      }
    }

    const upstreamUrl = new URL(request.url)
    upstreamUrl.protocol = 'https:'
    upstreamUrl.hostname = 'luckread-w02.internal'
    upstreamUrl.pathname = '/api/auth/' + endpoint

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')

    const upstream = await service.fetch(
      new Request(upstreamUrl.toString(), {
        method: request.method,
        headers,
        body:
          request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : request.body,
        redirect: 'manual',
      }),
    )

    if (
      request.method === 'POST' &&
      upstream.ok &&
      (endpoint === 'two-factor/verify-totp' || endpoint === 'two-factor/verify-backup-code')
    ) {
      // Better Auth's verify endpoints include the raw session token in JSON.
      // W01 owns the public auth DTO: promote the Bearer plugin's signed
      // session credential to the LuckRead header and never echo the raw token.
      const sessionToken = upstream.headers.get('set-auth-token')?.trim() ?? ''
      if (!sessionToken) {
        return errorResponse(502, 'AUTH_UPSTREAM_RESPONSE_INVALID', 'Authentication service returned an invalid MFA session')
      }
      const responseHeaders = new Headers(upstream.headers)
      responseHeaders.delete('set-auth-token')
      responseHeaders.delete('content-length')
      responseHeaders.delete('content-encoding')
      responseHeaders.delete('transfer-encoding')
      responseHeaders.set('content-type', 'application/json; charset=utf-8')
      responseHeaders.set('cache-control', 'no-store')
      responseHeaders.set('X-LuckRead-Session-Token', sessionToken)
      return new Response(JSON.stringify({
        data: { verified: true },
        requestId: `req_${crypto.randomUUID().replaceAll('-', '')}`,
      }), { status: upstream.status, headers: responseHeaders })
    }

    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('cache-control', 'no-store')

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch {
    return errorResponse(
      503,
      'SERVICE_UNAVAILABLE',
      'Authentication service unavailable',
    )
  }
}

export const GET = handler
export const POST = handler
