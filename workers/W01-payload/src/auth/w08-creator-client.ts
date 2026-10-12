import { getCloudflareContext } from '@opennextjs/cloudflare'

type W08CreatorService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W08CreatorClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function getW08Service(): Promise<W08CreatorService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W08_CREATOR?: W08CreatorService }).W08_CREATOR
  if (!service) throw new W08CreatorClientError(503, 'W08 creator service unavailable')
  return service
}

/** Proxy only fixed, caller-authored W08 paths; never accept a client path. */
export async function callW08Creator(request: Request, path: string, method: 'GET' | 'POST'): Promise<Response> {
  if (!path.startsWith('/api/v1/creator-applications') &&
      !path.startsWith('/api/v1/admin/creator-applications') &&
      !path.startsWith('/api/v1/admin/creator-scopes') &&
      !path.startsWith('/api/v1/creator-scopes')) {
    throw new W08CreatorClientError(400, 'invalid creator service path')
  }
  const service = await getW08Service()
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  let body: BodyInit | undefined
  if (method === 'POST') {
    body = await request.arrayBuffer()
    headers.set('content-type', request.headers.get('content-type') ?? 'application/json; charset=utf-8')
  }
  const response = await service.fetch(new Request('https://luckread-w08-creator.internal' + path, {
    method,
    headers,
    body,
  }))
  const outHeaders = new Headers()
  const contentType = response.headers.get('content-type')
  if (contentType) outHeaders.set('content-type', contentType)
  const etag = response.headers.get('etag')
  if (etag) outHeaders.set('etag', etag)
  outHeaders.set('cache-control', 'no-store')
  return new Response(await response.arrayBuffer(), { status: response.status, headers: outHeaders })
}

export function creatorServiceUnavailable(error: unknown): Response {
  const status = error instanceof W08CreatorClientError ? error.status : 503
  return Response.json(
    { error: { code: status === 400 ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE', message: 'Creator service unavailable', details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )
}
