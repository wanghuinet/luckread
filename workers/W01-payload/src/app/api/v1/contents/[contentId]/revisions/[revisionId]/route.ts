import {
  callW03Content,
  resolveContentPrincipal,
  W03ContentClientError,
} from '../../../../../../../content/w03-content-client.js'

const error = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, details: {} }, requestId: crypto.randomUUID() }, { status })

export async function GET(
  request: Request,
  context: { params: Promise<{ contentId: string; revisionId: string }> },
): Promise<Response> {
  try {
    const { contentId, revisionId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal

    return await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}/revisions/${encodeURIComponent(revisionId)}`,
      method: 'GET',
      principal,
    })
  } catch (e) {
    if (e instanceof W03ContentClientError) return error(e.status, e.code, 'Content service unavailable')
    return error(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ contentId: string; revisionId: string }> },
): Promise<Response> {
  try {
    const { contentId, revisionId } = await context.params
    const principal = await resolveContentPrincipal(request)
    if (principal instanceof Response) return principal

    let body: unknown = {}
    try {
      body = await request.json()
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }

    return await callW03Content({
      request,
      pathname: `/internal/content/contents/${encodeURIComponent(contentId)}/revisions/${encodeURIComponent(revisionId)}/rollback`,
      method: 'POST',
      body,
      principal,
    })
  } catch (e) {
    if (e instanceof W03ContentClientError) return error(e.status, e.code, 'Content service unavailable')
    return error(503, 'SERVICE_UNAVAILABLE', 'Content service unavailable')
  }
}
