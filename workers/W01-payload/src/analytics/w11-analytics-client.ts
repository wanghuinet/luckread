import { getCloudflareContext } from '@opennextjs/cloudflare'

type W11AnalyticsService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W11AnalyticsClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export type ClientAnalyticsEvent = {
  eventId: string
  dedupeKey: string
  eventName: string
  occurredAt: string
  sessionId: string
  contentId: string
  contentType: 'article' | 'post' | 'video'
  durationMs?: number
  position?: number
}

async function getW11AnalyticsService(): Promise<W11AnalyticsService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W11_ANALYTICS?: W11AnalyticsService }).W11_ANALYTICS
  if (!service) {
    throw new W11AnalyticsClientError(503, 'SERVICE_UNAVAILABLE', 'Analytics service unavailable')
  }
  return service
}

/** Forwards only the allow-listed client measurement payload and trusted W01 context. */
export async function callW11AnalyticsEvents(input: {
  request: Request
  events: ClientAnalyticsEvent[]
  principalUserId?: string
}): Promise<Response> {
  const service = await getW11AnalyticsService()
  const candidateCorrelationId = input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  const correlationId = /^[A-Za-z0-9:_-]{8,255}$/.test(candidateCorrelationId)
    ? candidateCorrelationId
    : crypto.randomUUID()
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': correlationId,
  })
  if (input.principalUserId) headers.set('X-LuckRead-Principal-User-Id', input.principalUserId)

  const response = await service.fetch(
    new Request('https://luckread-w11.internal/internal/analytics/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: input.events }),
    }),
  )
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
