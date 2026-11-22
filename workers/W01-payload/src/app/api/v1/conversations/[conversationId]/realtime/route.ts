import { getCloudflareContext } from '@opennextjs/cloudflare'
import { resolveCookieSocialPrincipal, W05SocialClientError } from '../../../../../../social/w05-social-client.js'

type RouteContext = { params: Promise<{ conversationId: string }> }

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket upgrade required', { status: 426 })
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    if (!principal.layer || Number(principal.layer.slice(1)) < 2) return Response.json({ error: { code: 'PERMISSION_DENIED' } }, { status: 403 })
    const { conversationId } = await context.params
    if (!conversationId?.trim()) return Response.json({ error: { code: 'VALIDATION_FAILED' } }, { status: 422 })
    const contextCloudflare = await getCloudflareContext({ async: true })
    const service = (contextCloudflare.env as unknown as { W05_SOCIAL?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> } }).W05_SOCIAL
    if (!service) return Response.json({ error: { code: 'SERVICE_UNAVAILABLE' } }, { status: 503 })
    const headers = new Headers(request.headers)
    headers.set('X-LuckRead-Caller', 'W01')
    headers.set('X-LuckRead-Transport-Version', '1.0')
    headers.set('X-LuckRead-Correlation-Id', request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID())
    headers.set('X-LuckRead-Principal-User-Id', principal.userId)
    headers.set('X-LuckRead-Principal-Layer', principal.layer)
    headers.set('X-LuckRead-Principal-Verified', principal.verified === true ? 'true' : 'false')
    const forwarded = new Request('https://luckread-w05.internal/internal/messaging/conversations/' + encodeURIComponent(conversationId) + '/realtime', { method: 'GET', headers })
    // Do not use the ordinary JSON relay here: it consumes the response body and loses status 101/webSocket.
    return await service.fetch(forwarded)
  } catch (error) {
    if (error instanceof W05SocialClientError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    return Response.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Messaging service unavailable' } }, { status: 503 })
  }
}
