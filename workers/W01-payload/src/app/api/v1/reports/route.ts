import {
  callW06Moderation,
  resolveCookieModerationPrincipal,
  W06ModerationClientError,
} from '../../../../../moderation/w06-moderation-public-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const validateBody = async (request: Request): Promise<Record<string, unknown> | Response> => {
  let body: unknown
  try { body = await request.json() } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid request body')
  }
  return body as Record<string, unknown>
}

export async function POST(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieModerationPrincipal(request)
    if (principal instanceof Response) return principal

    const body = await validateBody(request)
    if (body instanceof Response) return body

    const targetType = body.targetType
    const targetId = body.targetId
    const reasonCode = body.reasonCode
    const description = body.description
    const evidenceRefs = body.evidenceRefs

    if (
      (targetType !== 'content' && targetType !== 'comment' && targetType !== 'creator' && targetType !== 'media' && targetType !== 'profile') ||
      typeof targetId !== 'string' ||
      typeof reasonCode !== 'string' ||
      (description !== undefined && typeof description !== 'string') ||
      (evidenceRefs !== undefined && (!Array.isArray(evidenceRefs) || evidenceRefs.some((value) => typeof value !== 'string')))
    ) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid report payload')
    }

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    }

    return await callW06Moderation({
      request,
      pathname: '/reports',
      method: 'POST',
      principal,
      body: {
        targetType,
        targetId,
        reasonCode,
        ...(description !== undefined ? { description } : {}),
        ...(evidenceRefs !== undefined ? { evidenceRefs } : {}),
      },
    })
  } catch (error) {
    if (error instanceof W06ModerationClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Moderation service unavailable')
  }
}
