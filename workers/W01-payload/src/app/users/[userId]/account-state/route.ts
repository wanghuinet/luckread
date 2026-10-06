import {
  resolveBetterAuthPrincipal,
  transitionAccountState,
  W02AuthClientError,
} from '../../../../auth/w02-auth-client.js'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json(
    {
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    },
    status,
  )

type AccountStateBody = {
  to?: unknown
  reason?: unknown
}

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const { userId: targetUserId } = await context.params

  if (!targetUserId || targetUserId.length > 128) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid userId')
  }

  const ifMatch = request.headers.get('If-Match')?.trim() ?? ''
  let ifMatchValue = ifMatch
  if (ifMatchValue.startsWith('W/')) ifMatchValue = ifMatchValue.slice(2)
  if (ifMatchValue.startsWith('"') && ifMatchValue.endsWith('"')) {
    ifMatchValue = ifMatchValue.slice(1, -1)
  }
  const expectedVersion = Number(ifMatchValue)
  if (!ifMatch || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return errorResponse(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  }

  let body: AccountStateBody
  try {
    body = await request.json() as AccountStateBody
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }

  if (
    typeof body.to !== 'string' ||
    typeof body.reason !== 'string' ||
    body.reason.trim().length === 0 ||
    body.reason.length > 2048
  ) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account-state transition request')
  }

  try {
    const principal = await resolveBetterAuthPrincipal(request)
    const result = await transitionAccountState(request, {
      subjectId: principal.userId,
      targetUserId,
      to: body.to,
      reason: body.reason,
      expectedVersion,
    })

    return json({
      from: result.from,
      to: result.to,
      auditEventId: result.auditEventId,
    })
  } catch (error) {
    if (error instanceof W02AuthClientError) {
      if (error.status === 401) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
      if (error.status === 400) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid account-state transition request')
      if (error.status === 403) return errorResponse(403, 'PERMISSION_DENIED', 'Permission denied')
      if (error.status === 404) return errorResponse(404, 'NOT_FOUND', 'User account not found')
      if (error.status === 409) return errorResponse(409, 'INVALID_STATE', 'Invalid account-state transition')
      if (error.status === 412) return errorResponse(412, 'PRECONDITION_FAILED', 'Account-state precondition failed')
    }

    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Account-state service unavailable')
  }
}
