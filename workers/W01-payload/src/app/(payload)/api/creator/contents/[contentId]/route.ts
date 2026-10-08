import {
  invalidatePublicContentComments,
  invalidatePublicContentDetail,
  invalidatePublicContentList,
  invalidatePublicContentVisibility,
  invalidatePublicContentRelationships,
} from '../../../../../../lib/public-response-cache.js'
import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    return await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}`,
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Content service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    const response = await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}`,
      method: 'DELETE',
      principal,
    })
    if (response.ok) {
      await invalidatePublicContentComments(contentId)
      await invalidatePublicContentVisibility(contentId)
      await invalidatePublicContentRelationships(contentId)
      await invalidatePublicContentDetail(request, contentId)
      await invalidatePublicContentList(request)
    }
    return response
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Content service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return errorResponse(400, 'VALIDATION_FAILED', 'Invalid content request')
    }

    return await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}`,
      method: 'PATCH',
      body,
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) {
      return errorResponse(error.status, error.code, 'Content service unavailable')
    }
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
