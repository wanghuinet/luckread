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
      requestId: crypto.randomUUID(),
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

  if (
    request.method === 'POST' &&
    (
      endpoint === 'sign-in/email' ||
      endpoint === 'sign-up/email' ||
      endpoint === 'request-password-reset' ||
      endpoint === 'reset-password'
    )
  ) {
    try {
      const clientIp =
        request.headers.get('cf-connecting-ip')?.trim() || 'unknown'

      await enforceAuthRateLimit(
        request,
        endpoint === 'sign-up/email'
          ? 'AUTH_REGISTER_LIMITER'
          : 'AUTH_LOGIN_LIMITER',
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

    const upstreamUrl = new URL(request.url)
    upstreamUrl.protocol = 'https:'
    upstreamUrl.hostname = 'luckread-w02.internal'
    upstreamUrl.pathname = '/api/auth/' + endpoint

    const headers = new Headers(request.headers)
    headers.delete('host')
    headers.delete('content-length')
    // W02 Better Auth is internal to the W01 public gateway.
    // Never trust a client-supplied caller identity.
    headers.set('X-LuckRead-Caller', 'W01')

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
