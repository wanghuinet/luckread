import { getBetterAuthPrincipal, transitionAccountState, W02AuthClientError } from '../../../../auth/w02-session-client.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

const errorResponse = (status: number, code: string, message: string) =>
  json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, status)

type AccountStateBody = { to?: unknown; reason?: unknown }

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }): Promise<Response> {
  const { userId: targetUserId } = await context.params
  if (!targetUserId || targetUserId.length > 128) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid userId')

  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  if (!ifMatch) return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  if (ifMatch === '*') return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  if (ifMatch.length > 256) return errorResponse(422, 'VALIDATION_FAILED', 'Invalid If-Match header')
  let ifMatchValue = ifMatch
  if (ifMatchValue.startsWith('W/')) ifMatchValue = ifMatchValue.slice(2)
  if (ifMatchValue.startsWith('"') && ifMatchValue.endsWith('"')) ifMatchValue = ifMatchValue.slice(1, -1)
  const expectedVersion = Number(ifMatchValue)
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return errorResponse(412, 'PRECONDITION_FAILED', 'If-Match precondition failed')
  }

  let body: AccountStateBody
  try { body = await request.json() as AccountStateBody } catch {
    return errorResponse(422, 'VALIDATION_FAILED', 'Invalid account-state transition request')
  }
  if (typeof body.to !== 'string' || typeof body.reason !== 'string' || body.reason.trim().length === 0 || body.reason.length > 2048) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account-state transition request')
  }

  let principal
  try {
    principal = await getBetterAuthPrincipal(request)
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      return errorResponse(
        error.status === 401 ? 401 : 503,
        error.status === 401 ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE',
        error.status === 401 ? 'Authentication required' : 'Authentication service unavailable',
      )
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Authentication service unavailable')
  }

  try {
    const result = await transitionAccountState(request, {
        subjectId: principal.userId,
        targetUserId,
        to: body.to,
        reason: body.reason,
      expectedVersion,
    })
    return json({ from: result.from, to: result.to, auditEventId: result.auditEventId })
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      const status =
        error.status === 401 ? 401 :
        error.status === 403 ? 403 :
        error.status === 404 ? 404 :
        error.status === 409 ? 409 :
        error.status === 412 ? 412 :
        error.status === 422 || error.status === 400 ? 422 :
        error.status === 428 ? 428 :
        error.status === 429 ? 429 :
        503
      return errorResponse(
        status,
        status === 401 ? 'UNAUTHENTICATED' :
        status === 403 ? 'PERMISSION_DENIED' :
        status === 404 ? 'NOT_FOUND' :
        status === 409 ? 'INVALID_STATE' :
        status === 412 ? 'PRECONDITION_FAILED' :
        status === 422 ? 'VALIDATION_FAILED' :
        status === 428 ? 'PRECONDITION_REQUIRED' :
        status === 429 ? 'RATE_LIMITED' :
        'SERVICE_UNAVAILABLE',
        status === 401 ? 'Authentication required' :
        status === 403 ? 'Permission denied' :
        status === 404 ? 'User account not found' :
        status === 409 ? 'Invalid account-state transition' :
        status === 412 ? 'Account-state precondition failed' :
        status === 422 ? 'Invalid account-state request' :
        status === 428 ? 'If-Match is required' :
        status === 429 ? 'Too many requests' :
        'Account-state service unavailable',
      )
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Account-state service unavailable')
  }
}
