import { getBetterAuthPrincipal, transitionAccountState, W02AuthClientError } from '../../../../auth/w02-session-client.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

const errorResponse = (status: number, code: string, message: string) =>
  json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, status)

type AccountStateBody = { to?: unknown; reason?: unknown }

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }): Promise<Response> {
  const { userId: targetUserId } = await context.params
  if (!targetUserId || targetUserId.length > 128) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid userId')

  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  let ifMatchValue = ifMatch
  if (ifMatchValue.startsWith('W/')) ifMatchValue = ifMatchValue.slice(2)
  if (ifMatchValue.startsWith('"') && ifMatchValue.endsWith('"')) ifMatchValue = ifMatchValue.slice(1, -1)
  const expectedVersion = Number(ifMatchValue)
  if (!ifMatch || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  }

  let body: AccountStateBody
  try { body = await request.json() as AccountStateBody } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account-state transition request')
  }
  if (typeof body.to !== 'string' || typeof body.reason !== 'string' || body.reason.trim().length === 0 || body.reason.length > 2048) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account-state transition request')
  }

  let principal
  try { principal = await getBetterAuthPrincipal(request) }
  catch { return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required') }

  try {
    const result = await transitionAccountState(request, {
        subjectId: principal.userId,
        targetUserId,
        to: body.to,
        reason: body.reason,
        expectedVersion,
      },
    })
    return json({ from: result.from, to: result.to, auditEventId: result.auditEventId })
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      const status = error.status
      return errorResponse(
        status,
        status === 401 ? 'UNAUTHENTICATED' :
        status === 403 ? 'PERMISSION_DENIED' :
        status === 404 ? 'NOT_FOUND' :
        status === 409 ? 'INVALID_STATE' :
        status === 412 ? 'PRECONDITION_FAILED' :
        'VALIDATION_FAILED',
        status === 403 ? 'Permission denied' :
        status === 404 ? 'User account not found' :
        status === 409 ? 'Invalid account-state transition' :
        status === 412 ? 'Account-state precondition failed' :
        status === 400 ? 'Invalid account-state request' :
        'Authentication required',
      )
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Account-state service unavailable')
  }
}
