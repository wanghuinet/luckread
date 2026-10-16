// AUTH-013 W04 binding CI trigger: runtime implementation unchanged.
// Runtime evidence gate follows the admitted destination and queue binding.
// Final controlled runtime trigger.
// Consumer/DLQ live verification uses the dedicated Queue API.
// Final runtime evidence execution.
// Response-shape-safe consumer verification.
// Final live W04 gate trigger.
// Runtime artifact emission simplified.
// Final jq evidence trigger.
// Final runtime gate trigger.
// Runtime log evidence checkpoint.
// Node runtime evidence script.
// KV propagation-aware final gate.
import { applyAccountStateProjection, parseAccountStateChanged } from './auth-013-projection.js'

interface ProjectionKV {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string): Promise<void>
}
interface QueueMessage { body: unknown; ack(): void; retry(): void }
interface MessageBatchLike { messages: QueueMessage[] }
interface SocialFeedService {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
interface ContentFeedService { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
interface Env {
  AUTH013_W04_DERIVED_PROJECTION: ProjectionKV
  W05_SOCIAL: SocialFeedService
  W03_CONTENT?: ContentFeedService
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export default {
  async fetch(request: Request, env?: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/internal/feed/following') {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
      if (request.headers.get('X-LuckRead-Caller') !== 'W01' ||
          request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
          !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
          request.headers.has('Authorization') || request.headers.has('Cookie')) {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED', details: {} } }, 403)
      }
      const viewerUserId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(viewerUserId)) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'UNAUTHENTICATED', details: {} } }, 401)
      }
      const cursorValues = url.searchParams.getAll('cursor')
      const limitValues = url.searchParams.getAll('limit')
      if ([...url.searchParams.keys()].some((key) => key !== 'cursor' && key !== 'limit') ||
          cursorValues.length > 1 || limitValues.length > 1) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED', details: {} } }, 422)
      }
      const cursor = cursorValues[0]?.trim() ?? ''
      const limit = limitValues[0]?.trim() ?? '20'
      if ((cursor && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
          !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED', details: {} } }, 422)
      }
      if (!env?.W05_SOCIAL || !env?.W03_CONTENT) {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'SERVICE_UNAVAILABLE', details: {} } }, 503)
      }
      const correlationId = request.headers.get('X-LuckRead-Correlation-Id')!.trim()
      const transportHeaders = new Headers({
        'X-LuckRead-Caller': 'W04',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': correlationId,
        'X-LuckRead-Principal-User-Id': viewerUserId,
        'X-LuckRead-Rate-Key': 'user:' + viewerUserId,
      })
      const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim()
      if (layer && /^L[0-8]$/.test(layer)) transportHeaders.set('X-LuckRead-Principal-Layer', layer)

      try {
        const followsResponse = await env.W05_SOCIAL.fetch(new Request(
          'https://luckread-w05.internal/internal/social/feed/following-authors',
          { method: 'GET', headers: transportHeaders },
        ))
        const followsText = await followsResponse.text()
        if (!followsResponse.ok) {
          return new Response(followsText, {
            status: followsResponse.status,
            headers: { 'content-type': followsResponse.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
        }

        let followsPayload: { data?: { items?: Array<{ userId?: unknown }>; candidateWindowTruncated?: unknown } }
        try { followsPayload = JSON.parse(followsText) as typeof followsPayload } catch {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Social service returned an invalid response', details: {} } }, 503)
        }
        const candidateIds = Array.isArray(followsPayload.data?.items)
          ? [...new Set(followsPayload.data.items.map((item) => item?.userId).filter((id): id is string =>
              typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)))].slice(0, 500)
          : []
        const candidateWindowTruncated = followsPayload.data?.candidateWindowTruncated === true
        if (candidateIds.length === 0) {
          return json({ data: { items: [], nextCursor: null, hasMore: false, candidateWindowTruncated }, requestId: 'req_' + crypto.randomUUID() })
        }

        const contentQuery = new URLSearchParams({
          creatorIds: candidateIds.join(','),
          limit,
        })
        if (cursor) contentQuery.set('cursor', cursor)
        const contentResponse = await env.W03_CONTENT.fetch(new Request(
          'https://luckread-w03.internal/internal/content/following-feed?' + contentQuery.toString(),
          { method: 'GET', headers: transportHeaders },
        ))
        const contentText = await contentResponse.text()
        if (!contentResponse.ok) {
          return new Response(contentText, {
            status: contentResponse.status,
            headers: { 'content-type': contentResponse.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          })
        }
        let contentPayload: { data?: Record<string, unknown> }
        try { contentPayload = JSON.parse(contentText) as typeof contentPayload } catch {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Content service returned an invalid response', details: {} } }, 503)
        }
        return json({
          ...contentPayload,
          data: { ...(contentPayload.data ?? {}), candidateWindowTruncated },
        })
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Following feed service unavailable', details: {} } }, 503)
      }
    }
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ service: 'W04', status: 'ok', role: 'feed-recommendation-search', mode: 'projection-consumer' })
    }
    return new Response(null, { status: 404 })
  },

  async queue(batch: MessageBatchLike, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const event = parseAccountStateChanged(message.body)
        await applyAccountStateProjection(env.AUTH013_W04_DERIVED_PROJECTION, event)
        message.ack()
      } catch (error) {
        console.error(JSON.stringify({
          event: 'auth013.w04.projection_consumer_error',
          code: error instanceof Error ? error.message : 'UNKNOWN',
        }))
        message.retry()
      }
    }
  },
}
