import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
  resolveSocialProfileIdentityId,
} from '../../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    let body: unknown
    try { body = await request.json() } catch { return errorResponse(422, 'VALIDATION_FAILED', 'Invalid request body') }
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !['name', 'memberUserIds'].includes(key))) {
      return errorResponse(422, 'VALIDATION_FAILED', 'Invalid group payload')
    }
    const input = body as { name?: unknown; memberUserIds?: unknown }
    if (typeof input.name !== 'string' || !Array.isArray(input.memberUserIds) ||
      input.memberUserIds.length < 2 || input.memberUserIds.length > 49 ||
      input.memberUserIds.some(id => typeof id !== 'string')) {
      return errorResponse(422, 'VALIDATION_FAILED', 'A group requires a name and 2–49 existing direct contacts')
    }
    const memberUserIds = await Promise.all((input.memberUserIds as string[]).map(resolveSocialProfileIdentityId))
    return await callW05Social({
      request,
      pathname: '/internal/messaging/conversations/groups',
      method: 'POST',
      principal,
      body: { name: input.name, memberUserIds },
    })
  } catch (error) {
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Messaging service unavailable')
  }
}
