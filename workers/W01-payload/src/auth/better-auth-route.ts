import { handleBetterAuth } from './better-auth'

export async function proxyBetterAuth(
  request: Request,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<Response> {
  const url = new URL('/api/auth' + path, request.url)
  const headers = new Headers(request.headers)
  if (body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')

  return handleBetterAuth(
    new Request(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}
