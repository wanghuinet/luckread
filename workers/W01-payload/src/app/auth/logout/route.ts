import { proxyBetterAuth } from '../../../auth/w02-session-client.js'

export async function POST(request: Request): Promise<Response> {
  try {
    const response = await proxyBetterAuth(request, '/sign-out')
    if (response.status === 401) {
      return new Response(null, {
        status: 204,
        headers: { 'cache-control': 'no-store' },
      })
    }
    return response
  } catch {
    return Response.json({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Authentication service unavailable' },
      requestId: `req_${crypto.randomUUID()}`,
    }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
