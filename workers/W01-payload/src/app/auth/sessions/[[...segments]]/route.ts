import {
  listSessions,
  revokeOwnedSession,
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

const mapW02Error = (error: unknown): Response => {
  if (error instanceof W02AuthClientError) {
    if (error.status === 401) return json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } }, 401)
    if (error.status === 400) return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session request' } }, 400)
    if (error.status === 404) return json({ error: { code: 'NOT_FOUND', message: 'Session not found' } }, 404)
    if (error.status === 403) return json({ error: { code: 'PERMISSION_DENIED', message: 'Permission denied' } }, 403)
  }
  return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Session service unavailable' } }, 503)
}

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> },
): Promise<Response> {
  const { segments = [] } = await context.params
  if (segments.length !== 0) return new Response(null, { status: 404 })

  const url = new URL(request.url)
  const rawLimit = url.searchParams.get('limit')
  const limit = rawLimit === null ? undefined : Number(rawLimit)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)) {
    return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid session request' } }, 400)
  }

  try {
    const result = await listSessions(request, {
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit,
    })
    return json(result)
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

  try {
    await revokeOwnedSession(request, segments[0])
    return new Response(null, {
      status: 204,
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    return mapW02Error(error)
  }
}
