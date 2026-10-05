import {
  resolveBetterAuthPrincipalThroughW02,
  W02AuthClientError,
} from '../../../../auth/w02-session-client.js'

type AuthenticatedSubject = {
  userId: string
  sessionId: string
  tokenVersion: number
}

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
      error: {
        code,
        message,
        details: {},
      },
      requestId: crypto.randomUUID(),
    },
    status,
  )

async function authenticate(request: Request): Promise<AuthenticatedSubject> {
  const principal = await resolveBetterAuthPrincipalThroughW02(request)
  if (principal.tokenVersion === undefined) {
    throw new W02AuthClientError(401, 'authentication required')
  }

  return {
    userId: principal.userId,
    sessionId: principal.sessionId,
    tokenVersion: principal.tokenVersion,
  }
}

function mapW02Error(error: unknown): Response {
  if (error instanceof W02AuthClientError) {
    if (error.status === 401) return errorResponse(401, 'UNAUTHENTICATED', 'Authentication required')
    if (error.status === 403) return errorResponse(403, 'PERMISSION_DENIED', 'Permission denied')
    if (error.status === 400) return errorResponse(400, 'VALIDATION_FAILED', 'Invalid session request')
  }
  return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Session service unavailable')
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return new Response(null, { status: 404 })

  let subject: AuthenticatedSubject
  try {
    subject = await authenticate(request)
  } catch (error) {
    return mapW02Error(error)
  }

  const url = new URL(request.url)
  const cursor = url.searchParams.get('cursor') ?? undefined
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? undefined : Number(rawLimit)

  try {
    const result = await listSessions({
      userId: subject.userId,
      currentSessionId: subject.sessionId,
      tokenVersion: subject.tokenVersion,
      cursor,
      limit,
    })
    return json({
      ...result,
      currentSessionId: subject.sessionId,
    })
  } catch (error) {
    return mapW02Error(error)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 1 || !segments[0]) return new Response(null, { status: 404 })

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return errorResponse(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required')
  }

  let subject: AuthenticatedSubject
  try {
    subject = await authenticate(request)
  } catch (error) {
    return mapW02Error(error)
  }

  try {
    await revokeOwnedSession({
      userId: subject.userId,
      currentSessionId: subject.sessionId,
      tokenVersion: subject.tokenVersion,
      targetSessionId: segments[0],
    })
    return new Response(null, {
      status: 204,
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    return mapW02Error(error)
  }
}
