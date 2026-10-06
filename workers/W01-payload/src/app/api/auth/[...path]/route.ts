import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02AuthService = {
  fetch(input: Request): Promise<Response>
}

const getAuthService = async (): Promise<W02AuthService | null> => {
  const context = await getCloudflareContext({ async: true })
  return ((context.env as unknown as { W02_AUTH?: W02AuthService }).W02_AUTH) ?? null
}

const proxy = async (
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> => {
  const service = await getAuthService()
  if (!service) {
    return Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' } },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  }

  const { path = [] } = await context.params
  const authPath = path.join('/')
  if (!authPath) return new Response(null, { status: 404 })

  const headers = new Headers(request.headers)
  headers.delete('host')
  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()

  const upstream = await service.fetch(
    new Request('https://luckread-w02.internal/api/auth/' + authPath, {
      method: request.method,
      headers,
      body,
    }),
  )

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  })
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context)
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  return proxy(request, context)
}
