import { proxyBetterAuth } from '../../../auth/w02-session-client.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const response = await proxyBetterAuth(request, '/sign-out')
    if (response.ok || response.status === 401) {
      // The W01 logout API is no-content and idempotent. Preserve Better
      // Auth's Set-Cookie headers so the browser clears the session cookie.
      const headers = new Headers(response.headers)
      headers.delete('content-length')
      headers.delete('transfer-encoding')
      headers.set('cache-control', 'no-store')
      return new Response(null, {
        status: 204,
        headers,
      })
    }
    return response
  } catch {
    return Response.json({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' },
      requestId: crypto.randomUUID(),
    }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
