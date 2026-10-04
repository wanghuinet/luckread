import {
  callW03Content,
  resolveContentPrincipal,
  W03ContentClientError,
} from '../../../../../../content/w03-content-client.js'

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string }> },
): Promise<Response> {
  try {
    const { contentId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal

    const url = new URL(request.url)
    const query = new URLSearchParams()
    const cursor = url.searchParams.get('cursor')
    const limit = url.searchParams.get('limit')
    if (cursor) query.set('cursor', cursor)
    if (limit) query.set('limit', limit)

    return await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}/revisions?${query.toString()}`,
      method: 'GET',
      principal,
    })
  } catch (e) {
    if (e instanceof W03ContentClientError) return error(e.status, e.code, 'Content service unavailable')
    return error(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
