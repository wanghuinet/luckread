import {
  callW07Subscription,
  resolveCookieSubscriptionPrincipal,
  W07SubscriptionClientError,
} from '../../../../../../../subscription/w07-subscription-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

type RouteContext = { params: Promise<{ segments?: string[] }> }

const resolveOperation = (method: string, segments: string[] | undefined): { pathname: string; body?: unknown } | Response | null => {
  const parts = segments ?? []
  if (parts.length === 0 && method === 'POST') return { pathname: '/memberships/subscriptions' }
  if (parts.length === 1 && method === 'GET') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) }
  if (parts.length === 2 && method === 'POST' && ['cancel', 'pause', 'resume'].includes(parts[1]!)) {
    return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/' + parts[1]! }
  }
  if (parts.length === 2 && method === 'POST' && parts[1] === 'change-plan') return { pathname: '/memberships/subscriptions/' + encodeURIComponent(parts[0]!) + '/change-plan' }
  return null
}

const parseBody = async (request: Request): Promise<unknown | Response> => {
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid')
    return body
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid subscription request')
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
    const body = request.method === 'POST' ? await parseBody(request) : undefined
    if (body instanceof Response) return body
    return await callW07Subscription({ request, pathname: operation.pathname, method: request.method, principal, body })
  } catch (error) {
    if (error instanceof W07SubscriptionClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Subscription service unavailable')
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
export async function POST(request: Request, context: RouteContext): Promise<Response> { return forward(request, context) }
