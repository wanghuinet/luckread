import { applyAccountStateProjection, parseAccountStateChanged, type ProjectionRecord } from './auth-013-projection.js'

interface ProjectionKV {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string): Promise<void>
}
interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}
interface QueueMessage { body: unknown; ack(): void; retry(): void }
interface MessageBatchLike { messages: QueueMessage[] }
interface Env {
  AUTH013_W04_DERIVED_PROJECTION: ProjectionKV
  W03_CONTENT?: ServiceBinding
  W05_SOCIAL?: ServiceBinding
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })

const errorResponse = (status: number, code: string, message: string) =>
  json({ error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` }, status)

const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const activeAccountStates = new Set(['ACTIVE', 'RESTORED', 'REACTIVATED'])
const projectionKey = (userId: string) => `auth013:projection:User:${userId}`

const parseLimit = (value: string | null): number => {
  if (value === null || value.trim() === '') return 20
  const normalized = value.trim()
  if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(normalized)) throw new Error('INVALID_LIMIT')
  return Number(normalized)
}

const requireW01Transport = (request: Request): string => {
  const userId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
    !request.headers.get('X-LuckRead-Correlation-Id')?.trim() ||
    !resourceIdPattern.test(userId) ||
    request.headers.has('Authorization')
  ) throw new Error('UNTRUSTED_TRANSPORT')
  return userId
}

const projectionIsCurrent = (value: unknown, userId: string, now: number): value is ProjectionRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ProjectionRecord>
  return record.schemaVersion === 1 &&
    record.resourceType === 'User' &&
    record.resourceId === userId &&
    record.sourceAuthority === 'D1-01' &&
    typeof record.sourceVersion === 'number' &&
    record.state === 'ACTIVE' &&
    record.deindex === false &&
    typeof record.staleAfter === 'string' &&
    Number.isFinite(Date.parse(record.staleAfter)) &&
    Date.parse(record.staleAfter) > now
}

const projectionAllowsFeed = (value: ProjectionRecord): boolean =>
  value.state === 'ACTIVE' && !value.deindex && activeAccountStates.has(value.accountState)

const parseObject = async (response: Response): Promise<Record<string, unknown> | null> => {
  try {
    const value = await response.json()
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ service: 'W04', status: 'ok', role: 'feed-recommendation-search', mode: 'projection-consumer-and-following-feed' })
    }
    if (url.pathname !== '/internal/feed/following') return new Response(null, { status: 404 })
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } })

    let viewerUserId: string
    let limit: number
    try {
      viewerUserId = requireW01Transport(request)
      if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Invalid feed query')
      }
      const cursor = url.searchParams.get('cursor')
      if (cursor !== null && (!cursor || cursor.length > 2048)) {
        return errorResponse(400, 'VALIDATION_FAILED', 'Invalid feed cursor')
      }
      limit = parseLimit(url.searchParams.get('limit'))
    } catch (error) {
      const code = error instanceof Error && error.message === 'UNTRUSTED_TRANSPORT'
        ? 'PERMISSION_DENIED'
        : 'VALIDATION_FAILED'
      return errorResponse(code === 'PERMISSION_DENIED' ? 403 : 400, code, code === 'PERMISSION_DENIED' ? 'Permission denied' : 'Invalid feed query')
    }

    const now = Date.now()
    let viewerProjection: unknown
    try {
      viewerProjection = await env.AUTH013_W04_DERIVED_PROJECTION.get(projectionKey(viewerUserId), 'json')
    } catch {
      return errorResponse(503, 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', 'Account state could not be verified')
    }
    if (!viewerProjection || !projectionIsCurrent(viewerProjection, viewerUserId, now)) {
      return errorResponse(503, 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', 'Account state could not be verified')
    }
    if (!projectionAllowsFeed(viewerProjection)) {
      return errorResponse(403, 'PERMISSION_DENIED', 'Account is not eligible to read this feed')
    }
    if (!env.W05_SOCIAL || !env.W03_CONTENT) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Feed dependencies are unavailable')
    }

    const correlationId = request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID()
    const transportHeaders = new Headers({
      'X-LuckRead-Caller': 'W04',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Correlation-Id': correlationId,
      'X-LuckRead-Principal-User-Id': viewerUserId,
      'X-LuckRead-Rate-Key': 'user:' + viewerUserId,
    })

    let candidateResponse: Response
    try {
      candidateResponse = await env.W05_SOCIAL.fetch(
        new Request('https://luckread-w05.internal/internal/social/users/' +
          encodeURIComponent(viewerUserId) + '/following-feed-candidates', {
          method: 'GET',
          headers: transportHeaders,
        }),
      )
    } catch {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Following relationships are unavailable')
    }
    if (!candidateResponse.ok) {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Following relationships are unavailable')
    }
    const candidateEnvelope = await parseObject(candidateResponse)
    const candidateData = candidateEnvelope?.data as { userIds?: unknown; hasMore?: unknown } | undefined
    if (
      !candidateData ||
      !Array.isArray(candidateData.userIds) ||
      candidateData.userIds.length > 500 ||
      typeof candidateData.hasMore !== 'boolean' ||
      candidateData.userIds.some((id) => typeof id !== 'string' || !resourceIdPattern.test(id))
    ) {
      return errorResponse(503, 'INVALID_FEED_DEPENDENCY_RESPONSE', 'Following relationships returned an invalid response')
    }

    let eligibleOwners: string[]
    try {
      const ownerEligibility = await Promise.all(candidateData.userIds.map(async (id) => {
        const projection = await env.AUTH013_W04_DERIVED_PROJECTION.get(projectionKey(id as string), 'json')
        if (!projectionIsCurrent(projection, id as string, now)) return null
        return projectionAllowsFeed(projection) ? id as string : null
      }))
      eligibleOwners = [...new Set(ownerEligibility.filter((id): id is string => typeof id === 'string'))]
    } catch {
      return errorResponse(503, 'ACCOUNT_STATE_PROJECTION_UNAVAILABLE', 'Following account eligibility could not be verified')
    }

    const cursor = url.searchParams.get('cursor')
    if (eligibleOwners.length === 0) {
      return json({
        data: { items: [], nextCursor: null, hasMore: false, candidateWindowTruncated: candidateData.hasMore },
        requestId: `req_${crypto.randomUUID()}`,
      })
    }

    let contentResponse: Response
    try {
      contentResponse = await env.W03_CONTENT.fetch(
        new Request('https://luckread-w03.internal/internal/content/following-feed', {
          method: 'POST',
          headers: new Headers({
            ...Object.fromEntries(transportHeaders.entries()),
            'content-type': 'application/json; charset=utf-8',
          }),
          body: JSON.stringify({ ownerUserIds: eligibleOwners, cursor, limit }),
        }),
      )
    } catch {
      return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Following content is unavailable')
    }
    if (!contentResponse.ok) {
      const failure = await parseObject(contentResponse)
      return errorResponse(
        contentResponse.status >= 400 && contentResponse.status < 500 ? contentResponse.status : 503,
        typeof (failure?.error as { code?: unknown } | undefined)?.code === 'string'
          ? (failure?.error as { code: string }).code
          : 'SERVICE_UNAVAILABLE',
        'Following content could not be loaded',
      )
    }
    const contentEnvelope = await parseObject(contentResponse)
    const contentData = contentEnvelope?.data as { items?: unknown; nextCursor?: unknown; hasMore?: unknown } | undefined
    if (
      !contentData ||
      !Array.isArray(contentData.items) ||
      !(contentData.nextCursor === null || typeof contentData.nextCursor === 'string') ||
      typeof contentData.hasMore !== 'boolean'
    ) {
      return errorResponse(503, 'INVALID_FEED_DEPENDENCY_RESPONSE', 'Following content returned an invalid response')
    }
    return json({
      data: { ...contentData, candidateWindowTruncated: candidateData.hasMore },
      requestId: `req_${crypto.randomUUID()}`,
    })
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
