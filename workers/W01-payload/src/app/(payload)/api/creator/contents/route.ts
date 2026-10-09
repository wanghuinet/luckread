import {
  callW03Content,
  resolveCookieContentPrincipal,
  W03ContentClientError,
} from '../../../../../content/w03-content-client.js'

const errorResponse = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
    { status, headers: { 'cache-control': 'no-store' } },
  )

export async function POST(request: Request): Promise<Response> {
  try {
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
      pathname: '/internal/content/contents',
      method: 'POST',
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
export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await resolveCookieContentPrincipal(request)
    if (principal instanceof Response) return principal

    const url = new URL(request.url)
    return await callW03Content({
      request,
      pathname: `/internal/content/creator-contents${url.search}`,
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
