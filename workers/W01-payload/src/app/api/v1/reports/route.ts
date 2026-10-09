import { callW06Moderation, W06ModerationClientError } from '../../../../moderation/w06-moderation-client.js'
import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../content/w03-content-client.js'
import { assertSocialTargetUserExists } from '../../../../social/w05-social-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status: code === 'VALIDATION_FAILED' && status === 400 ? 422 : status, headers: { 'cache-control': 'no-store' } },
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
    const principal = await resolveCookieContentPrincipal(request)
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
      !targetId.trim() ||
      targetId.length > 128 ||
      typeof reasonCode !== 'string' ||
      !reasonCode.trim() ||
      reasonCode.length > 128 ||
      (description !== undefined && (typeof description !== 'string' || description.length > 4000)) ||
      (evidenceRefs !== undefined && (
        !Array.isArray(evidenceRefs) ||
        evidenceRefs.length > 20 ||
        evidenceRefs.some((value) => typeof value !== 'string' || value.length > 512)
      ))
    ) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid report payload')
    }

    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
    if (!idempotencyKey) {
      return errorResponse(428, 'PRECONDITION_REQUIRED', 'Idempotency-Key is required')
    }

    if (targetType === 'creator' || targetType === 'profile') {
      try {
        await assertSocialTargetUserExists(targetId as string)
      } catch (error) {
        if (error instanceof W03ContentClientError) throw error
        if (error instanceof Error && 'status' in error && 'code' in error) {
          const clientError = error as { status: number; code: string; message: string }
          return errorResponse(
            clientError.status,
            clientError.code === 'NOT_FOUND' ? 'RESOURCE_NOT_FOUND' : clientError.code,
            clientError.message,
          )
        }
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'User service unavailable')
      }
    }

    if (targetType === 'content') {
      const targetResponse = await callW03Content({
        request,
        pathname: '/internal/content/contents/' + encodeURIComponent(targetId as string),
        method: 'GET',
        principal,
      })
      if (!targetResponse.ok) {
        return errorResponse(targetResponse.status === 404 ? 404 : 503, targetResponse.status === 404 ? 'RESOURCE_NOT_FOUND' : 'SERVICE_UNAVAILABLE', targetResponse.status === 404 ? 'Reported content not found' : 'Content service unavailable')
      }
      const targetData = await targetResponse.json().catch((): null => null) as { id?: string; state?: string } | null
      if (targetData?.id !== targetId || targetData.state !== 'PUBLISHED') {
        return errorResponse(404, 'RESOURCE_NOT_FOUND', 'Reported content not found')
      }
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
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, error.message)
    if (error instanceof W06ModerationClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Moderation service unavailable')
  }
}
