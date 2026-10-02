import {
  callW05Social,
  resolveCookieSocialPrincipal,
  W05SocialClientError,
} from '../../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const parseTarget = async (request: Request): Promise<{ targetType: string; targetId: string } | Response> => {
  try {
    const value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    const targetType = (value as { targetType?: unknown }).targetType
    const targetId = (value as { targetId?: unknown }).targetId
    if (typeof targetType !== 'string' || typeof targetId !== 'string') throw new Error('invalid')
    return { targetType, targetId }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid like target')
  }
}

async function forward(request: Request, method: 'POST' | 'DELETE'): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const target = await parseTarget(request)
    if (target instanceof Response) return target
    return await callW05Social({
      request,
      pathname: '/internal/social/interactions/likes',
      method,
      principal,
      body: target,
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) {
      return errorResponse(error.status, error.code, error.message)
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Social service unavailable')
  }
}

export async function POST(request: Request): Promise<Response> {
  return forward(request, 'POST')
}

export async function DELETE(request: Request): Promise<Response> {
  return forward(request, 'DELETE')
}