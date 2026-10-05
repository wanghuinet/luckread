import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W02UserProfileClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function getW02Service(): Promise<W02ServiceBinding> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02ServiceBinding }).W02_AUTH
  if (!service) throw new W02UserProfileClientError(503, 'W02 authentication service is unavailable')
  return service
}

export async function callW02UserProfile(
  request: Request,
  path: string,
  method: 'GET' | 'PATCH',
  body?: unknown,
): Promise<Response> {
  const service = await getW02Service()
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('X-LuckRead-Caller', 'W01')
  if (body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')

  try {
    return await service.fetch(
      new Request('https://luckread-w02.internal' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  } catch {
    throw new W02UserProfileClientError(503, 'W02 authentication service is unavailable')
  }
}