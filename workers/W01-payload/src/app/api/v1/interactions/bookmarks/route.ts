import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
  )

const parseQueryTarget = (request: Request): { targetType: string; targetId: string } | Response => {
  const url = new URL(request.url)
  const targetType = url.searchParams.get('targetType')
  const targetId = url.searchParams.get('targetId')
  if (!targetType || !targetId) {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark target')
  }
  return { targetType, targetId }
}

const parseTarget = async (request: Request): Promise<{ targetType: string; targetId: string } | Response> => {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const targetType = (value as { targetType?: unknown }).targetType
    const targetId = (value as { targetId?: unknown }).targetId
    if (typeof targetType !== 'string' || typeof targetId !== 'string') throw new Error('invalid')
    return { targetType, targetId }
  } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid bookmark target')
  }
}

async function forward(request: Request, method: 'GET' | 'POST' | 'DELETE'): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal

    if (method !== 'GET') {
      const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
      if (!idempotencyKey) {
        return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
      }
      if (idempotencyKey.length > 256) {
        return errorResponse(422, 'VALIDATION_FAILED', 'Invalid Idempotency-Key header')
      }
    }

    const target = method === 'GET' ? parseQueryTarget(request) : await parseTarget(request)
    if (target instanceof Response) return target

    const pathname = method === 'GET'
      ? '/internal/social/interactions/bookmarks?targetType=' + encodeURIComponent(target.targetType) + '&targetId=' + encodeURIComponent(target.targetId)
      : '/internal/social/interactions/bookmarks'

    return await callW05Social({
      request,
      pathname,
      method,
      principal,
      body: method === 'GET' ? undefined : target,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function GET(request: Request): Promise<Response> {
  return forward(request, 'GET')
}

export async function POST(request: Request): Promise<Response> {
  return forward(request, 'POST')
}

export async function DELETE(request: Request): Promise<Response> {
  return forward(request, 'DELETE')
}
