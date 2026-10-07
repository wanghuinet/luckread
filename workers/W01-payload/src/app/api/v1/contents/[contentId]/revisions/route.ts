import { resolveCookieContentPrincipal, callW03Content, W03ContentClientError } from '../../../../../../content/w03-content-client.js'

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
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal
    const { contentId } = await context.params
    const url = new URL(request.url)
    return await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}/revisions${url.search}`,
      method: 'GET',
      principal,
    })
  } catch (error) {
    if (error instanceof W03ContentClientError) return errorResponse(error.status, error.code, 'Content revision service unavailable')
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Content revision service unavailable')
  }
}
