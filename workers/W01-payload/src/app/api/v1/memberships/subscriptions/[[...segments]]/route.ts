import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../subscription/w07-subscription-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }

const resolveOperation = (method: string, segments: string[] | undefined): { pathname: string; body?: unknown } | Response | null => {
  const parts = segments ?? []
  if (parts.length === 0 && method === 'GET') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 0 && method === 'POST') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 1 && method === 'GET') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) }
  if (parts.length === 2 && method === 'GET' && parts[1] === 'change-plan-preview') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan-preview' }
  if (parts.length === 2 && method === 'POST' && ['cancel', 'pause', 'resume'].includes(parts[1]!)) {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/' + parts[1]! }
  }
  if (parts.length === 2 && method === 'POST' && parts[1] === 'change-plan') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan' }
  if (parts.length === 3 && method === 'POST' && parts[1] === 'change-plan' && parts[2] === 'checkout') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan/checkout' }
  return null
}


async function readBoundedJson(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^application\\/json(?:\\s*;|$)/i.test(contentType)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'A JSON request body is required')
  }
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null && (!/^\\d+$/.test(declaredLength) || Number(declaredLength) > 16_384)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Request body is too large or malformed')
  }
  if (!request.body) return errorResponse(400, 'VALIDATION_FAILED', 'A JSON request body is required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > 16_384) {
        await reader.cancel()
        return errorResponse(400, 'VALIDATION_FAILED', 'Request body is too large')
      }
      chunks.push(part.value)
    }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON request body is required')
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON request body is required')
  }
}

async function forward(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params
    const operation = resolveOperation(request.method, params.segments)
    if (!operation) return new Response(null, { status: 404 })
    if (operation instanceof Response) return operation
    const principal = await resolveCookieSubscriptionPrincipal(request)
    if (principal instanceof Response) return principal

    const parts = params.segments ?? []
    const isPlanUpgradeCheckout = request.method === 'POST' && parts.length === 3 &&
      parts[1] === 'change-plan' && parts[2] === 'checkout'
    if (request.method === 'POST') {
      if (!isPlanUpgradeCheckout) {
        return errorResponse(
          503,
          'SERVICE_UNAVAILABLE',
          'Subscription writes are disabled until a verified payment-provider synchronization flow is available.',
        )
      }
      const body = await readBoundedJson(request)
      if (body instanceof Response) return body
      return await callW07Subscription({
        request,
        pathname: operation.pathname,
        method: 'POST',
        principal,
        body,
      })
    }
    const isSubscriptionList = (params.segments ?? []).length === 0
    const isPlanChangePreview = (params.segments ?? []).length === 2 && params.segments?.[1] === 'change-plan-preview'
    const pathname = request.method === 'GET' && (isSubscriptionList || isPlanChangePreview)
      ? operation.pathname + new URL(request.url).search
      : operation.pathname
    return await callW07Subscription({ request, pathname, method: 'GET', principal })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
