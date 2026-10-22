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
import { applyAccountStateProjection, parseAccountStateChanged, type ProjectionRecord } from './auth-013-projection.js'
import { listTrendingSearches, recordSearchTrend } from './search-trends.js'

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

const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const activeAccountStates = new Set(['ACTIVE', 'RESTORED', 'REACTIVATED'])
const projectionKey = (userId: string) => 'auth013:projection:User:' + userId

const projectionIsCurrent = (value: unknown, userId: string, now: number): value is ProjectionRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ProjectionRecord>
  return record.schemaVersion === 1 &&
    record.resourceType === 'User' &&
    record.resourceId === userId &&
    record.sourceAuthority === 'D1-01' &&
    typeof record.sourceVersion === 'number' &&
    Number.isSafeInteger(record.sourceVersion) &&
    record.sourceVersion > 0 &&
    record.policyVersion === 'AUTH-013-v1' &&
    (record.state === 'ACTIVE' || record.state === 'PURGED') &&
    typeof record.deindex === 'boolean' &&
    ((record.state === 'PURGED') === record.deindex) &&
    typeof record.staleAfter === 'string' &&
    Number.isFinite(Date.parse(record.staleAfter)) &&
    Date.parse(record.staleAfter) > now
}

const projectionAllowsFeed = (record: ProjectionRecord): boolean =>
  record.state === 'ACTIVE' && !record.deindex && activeAccountStates.has(record.accountState)

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

export default {
  async fetch(request: Request, env?: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/internal/search/trending') {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
        !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
        request.headers.has('Authorization') ||
        request.headers.has('Cookie') ||
        request.headers.has('X-LuckRead-Principal-User-Id')
      ) {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED', details: {} } }, 403)
      }

      const allowed = new Set(['limit'])
      let invalidQuery = url.search.length > 256
      url.searchParams.forEach((_value, key) => {
        if (!allowed.has(key)) invalidQuery = true
      })
      const limitValues = url.searchParams.getAll('limit')
      const limit = limitValues[0]?.trim() ?? '10'
      if (invalidQuery || limitValues.length > 1 || !/^(?:[1-9]|1[0-9]|20)$/.test(limit)) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid trending search limit', details: {} } }, 422)
      }

      const items = await listTrendingSearches(Number(limit))
      const requestId = 'req_' + crypto.randomUUID()
      return json({
        data: { items, nextCursor: null, hasMore: false },
        requestId,
        traceId: request.headers.get('X-LuckRead-Correlation-Id')!.trim(),
      })
    }

    if (url.pathname === '/internal/search/contents') {
      if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
        !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
        request.headers.has('Authorization') ||
        request.headers.has('Cookie') ||
        request.headers.has('X-LuckRead-Principal-User-Id')
      ) {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'PERMISSION_DENIED', details: {} } }, 403)
      }

      const allowed = new Set(['q', 'cursor', 'limit'])
      let invalidQuery = url.search.length > 4096
      url.searchParams.forEach((_value, key) => {
        if (!allowed.has(key)) invalidQuery = true
      })
      const qValues = url.searchParams.getAll('q')
      const cursorValues = url.searchParams.getAll('cursor')
      const limitValues = url.searchParams.getAll('limit')
      const query = qValues[0]?.normalize('NFKC').trim() ?? ''
      const cursor = cursorValues[0]?.trim() ?? ''
      const limit = limitValues[0]?.trim() ?? '20'
      if (
        invalidQuery ||
        qValues.length !== 1 ||
        cursorValues.length > 1 ||
        limitValues.length > 1 ||
        !query ||
        query.length > 256 ||
        (cursor && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
        !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'Invalid search query', details: {} } }, 422)
      }
      if (!env?.W03_CONTENT) {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Search content service unavailable', details: {} } }, 503)
      }

      const correlationId = request.headers.get('X-LuckRead-Correlation-Id')!.trim()
      const transportHeaders = new Headers({
        'X-LuckRead-Caller': 'W04',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Correlation-Id': correlationId,
        'X-LuckRead-Rate-Key': request.headers.get('X-LuckRead-Rate-Key')?.trim() || 'transport:W01',
        'content-type': 'application/json; charset=utf-8',
      })
      try {
        const contentResponse = await env.W03_CONTENT.fetch(new Request(
          'https://luckread-w03.internal/internal/content/search',
          {
            method: 'POST',
            headers: transportHeaders,
            body: JSON.stringify({ q: query, cursor: cursor || null, limit: Number(limit) }),
          },
        ))
        const contentText = await contentResponse.text()
        if (!contentResponse.ok) {
          return new Response(contentText, {
            status: contentResponse.status,
            headers: {
              'content-type': contentResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
              'cache-control': 'no-store',
            },
          })
        }

        let payload: { data?: { items?: unknown[]; nextCursor?: unknown; hasMore?: unknown }; requestId?: unknown }
        try { payload = JSON.parse(contentText) as typeof payload } catch {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Content service returned invalid search data', details: {} } }, 503)
        }
        if (
          !payload.data ||
          !Array.isArray(payload.data.items) ||
          typeof payload.data.hasMore !== 'boolean' ||
          (payload.data.nextCursor !== null && typeof payload.data.nextCursor !== 'string')
        ) {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Content service returned invalid search data', details: {} } }, 503)
        }
        if (!cursor && payload.data.items.length > 0) {
          await recordSearchTrend(query)
        }
        return json(payload)
      } catch {
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Search content service unavailable', details: {} } }, 503)
      }
    }

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
      let invalidQueryKey = false
      url.searchParams.forEach((_value, key) => {
        if (key !== 'cursor' && key !== 'limit') invalidQueryKey = true
      })
      if (invalidQueryKey || cursorValues.length > 1 || limitValues.length > 1) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED', details: {} } }, 422)
      }
      const cursor = cursorValues[0]?.trim() ?? ''
      const limit = limitValues[0]?.trim() ?? '20'
      if ((cursor && (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))) ||
          !/^(?:[1-9]|[1-4][0-9]|50)$/.test(limit)) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'VALIDATION_FAILED', details: {} } }, 422)
      }
      if (!env?.AUTH013_W04_DERIVED_PROJECTION) {
        return json({ error: { code: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', message: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', details: {} } }, 503)
      }
      const now = Date.now()
      let viewerProjection: unknown
      try {
        viewerProjection = await env.AUTH013_W04_DERIVED_PROJECTION.get(projectionKey(viewerUserId), 'json')
      } catch {
        return json({ error: { code: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', message: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', details: {} } }, 503)
      }
      if (!projectionIsCurrent(viewerProjection, viewerUserId, now)) {
        return json({ error: { code: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', message: 'Account state could not be verified', details: {} } }, 503)
      }
      if (!projectionAllowsFeed(viewerProjection)) {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'Account is not eligible to read this feed', details: {} } }, 403)
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
        const followData = followsPayload.data
        if (
          !followData ||
          !Array.isArray(followData.items) ||
          typeof followData.candidateWindowTruncated !== 'boolean' ||
          followData.items.length > 500
        ) {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Social service returned an invalid response', details: {} } }, 503)
        }
        const rawAuthorIds = followData.items.map((item) => item?.userId)
        if (rawAuthorIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))) {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Social service returned an invalid author ID', details: {} } }, 503)
        }
        const candidateIds = [...new Set(rawAuthorIds as string[])]
        const candidateWindowTruncated = followData.candidateWindowTruncated
        let eligibleOwnerIds: string[]
        try {
          const eligibility = await Promise.all(candidateIds.map(async (userId) => {
            const projection = await env.AUTH013_W04_DERIVED_PROJECTION!.get(projectionKey(userId), 'json')
            if (!projectionIsCurrent(projection, userId, now)) return null
            return projectionAllowsFeed(projection) ? userId : null
          }))
          eligibleOwnerIds = [...new Set(eligibility.filter((userId): userId is string => typeof userId === 'string'))]
        } catch {
          return json({ error: { code: 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', message: 'Following account eligibility could not be verified', details: {} } }, 503)
        }
        if (eligibleOwnerIds.length === 0) {
          return json({ data: { items: [], nextCursor: null, hasMore: false, candidateWindowTruncated }, requestId: 'req_' + crypto.randomUUID() })
        }

        const contentHeaders = new Headers(transportHeaders)
        contentHeaders.set('content-type', 'application/json; charset=utf-8')
        const contentResponse = await env.W03_CONTENT.fetch(new Request(
          'https://luckread-w03.internal/internal/content/following-feed',
          {
            method: 'POST',
            headers: contentHeaders,
            body: JSON.stringify({
              ownerUserIds: eligibleOwnerIds,
              limit: Number(limit),
              cursor: cursor || null,
            }),
          },
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
        const feedData = contentPayload.data
        if (
          !feedData ||
          !Array.isArray(feedData.items) ||
          typeof feedData.hasMore !== 'boolean' ||
          (feedData.nextCursor !== null && typeof feedData.nextCursor !== 'string')
        ) {
          return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Content service returned an invalid feed page', details: {} } }, 503)
        }
        return json({
          ...contentPayload,
          data: { ...feedData, candidateWindowTruncated },
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
