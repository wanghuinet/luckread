import { proxyBetterAuth } from '../../../auth/w02-session-client.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const response = await proxyBetterAuth(request, '/sign-out')
    if (response.ok || response.status === 401) {
      // W01 logout is a no-content operation. Preserve cookie clearing for
      // browser clients, but never echo the credential being revoked.
      const headers = new Headers(response.headers)
      headers.delete('content-length')
      headers.delete('content-encoding')
      headers.delete('transfer-encoding')
      headers.delete('set-auth-token')
      headers.delete('X-LuckRead-Session-Token')
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
