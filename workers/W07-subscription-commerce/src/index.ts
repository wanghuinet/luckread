/// <reference types="@cloudflare/workers-types" />

import { createMembershipPlanDraft, getSubscription, listActiveMembershipPlans, listCreatorMembershipPlans, listSubscriptions, parseBoundedPositiveInt, SubscriptionRuntimeError, validatePrincipal } from './subscription-runtime.js'

interface RateLimitBinding { limit(input: { key: string }): Promise<{ success: boolean }> }
interface Env {
  D1_01: D1Database
  SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER?: RateLimitBinding
  SUBSCRIPTION_READ_LIMITER?: RateLimitBinding
  SUBSCRIPTION_WRITE_LIMITER?: RateLimitBinding
}

const getRateKey = (request: Request): string => {
  const principal = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  if (principal.length > 0 && principal.length <= 256) return 'principal:' + principal
  const clientIp = request.headers.get('X-LuckRead-Client-IP')?.trim() ?? ''
  if (clientIp.length > 0 && clientIp.length <= 128) return 'client:' + clientIp
  return 'transport:W01'
}

const applyRateLimit = async (limiter: RateLimitBinding, key: string): Promise<void> => {
  try {
    const result = await limiter.limit({ key })
    if (!result.success) throw new SubscriptionRuntimeError('RATE_LIMITED', 429)
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  }
}

const enforceRateLimit = async (request: Request, env: Env): Promise<void> => {
  const operation = request.method === 'GET' ? 'read' : 'write'
  const originLimiter = env.SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER
  if (!originLimiter) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  await applyRateLimit(originLimiter, 'origin:' + operation)

  const actorLimiter = operation === 'read' ? env.SUBSCRIPTION_READ_LIMITER : env.SUBSCRIPTION_WRITE_LIMITER
  if (!actorLimiter) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  await applyRateLimit(actorLimiter, operation + ':' + getRateKey(request))
}

const json = (body: unknown, status = 200, etag?: string) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(etag ? { ETag: etag } : {}) } })

const requireTransport = (request: Request): void => {
  if (request.headers.get('X-LuckRead-Caller') !== 'W01' || request.headers.get('X-LuckRead-Transport-Version') !== '1.0' || !request.headers.get('X-LuckRead-Correlation-Id')?.trim()) throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
}

const requirePrincipal = (request: Request): string => { requireTransport(request); return validatePrincipal(request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? '') }

const requireLayer = (request: Request): void => {
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (!/^L[0-8]$/.test(layer) || Number(layer.slice(1)) < 2) throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
}

const parseSegments = (pathname: string): string[] => pathname.split('/').filter(Boolean).map((segment) => { try { return decodeURIComponent(segment) } catch { throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400) } })

const requireCreatorLayer = (request: Request): void => {
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (layer !== 'L3' && layer !== 'L4') throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
}

const requireVerifiedCreatorId = (request: Request): string => {
  const creatorId = request.headers.get('X-LuckRead-Verified-Creator-Id')?.trim() ?? ''
  if (!creatorId || creatorId.length > 256) throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
  return validatePrincipal(creatorId)
}

const readJsonBody = async (request: Request): Promise<unknown> => {
  const declaredLength = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!request.body) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > 16_384) {
        await reader.cancel()
        throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
      }
      chunks.push(part.value)
    }
  } catch (error) {
    if (error instanceof SubscriptionRuntimeError) throw error
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
  }
}

type Operation =
  | { operation: 'listPlans'; subscriptionId: null }
  | { operation: 'listOwnedPlans'; subscriptionId: null }
  | { operation: 'createPlan'; subscriptionId: null }
  | { operation: 'list'; subscriptionId: null }
  | { operation: 'get'; subscriptionId: string }

const toOperation = (method: string, segments: string[]): Operation | null => {
  if (segments.length === 1 && segments[0] === 'plans' && method === 'GET') return { operation: 'listPlans', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'membership' && segments[1] === 'plans' && method === 'GET') return { operation: 'listOwnedPlans', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'membership' && segments[1] === 'plans' && method === 'POST') return { operation: 'createPlan', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'list', subscriptionId: null }
  if (segments.length === 3 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'get', subscriptionId: segments[2] }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await enforceRateLimit(request, env)
      requireTransport(request)
      const principal = requirePrincipal(request)
      requireLayer(request)
      const operation = toOperation(request.method, parseSegments(new URL(request.url).pathname))
      if (request.method === 'POST' && operation?.operation !== 'createPlan') {
        return json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Subscription writes are disabled until verified payment-provider synchronization is available.',
            details: {},
          },
          requestId: crypto.randomUUID(),
        }, 503)
      }
      if (!operation) return new Response(null, { status: 404 })
      if (operation.operation === 'createPlan') {
        requireCreatorLayer(request)
        const creatorId = requireVerifiedCreatorId(request)
        const result = await createMembershipPlanDraft(
          env.D1_01,
          principal,
          creatorId,
          await readJsonBody(request),
          request.headers.get('Idempotency-Key'),
        )
        return json({ data: result, requestId: crypto.randomUUID() }, result.replayed ? 200 : 201, result.etag)
      }
      if (operation.operation === 'listOwnedPlans') {
        requireCreatorLayer(request)
        const creatorId = requireVerifiedCreatorId(request)
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const result = await listCreatorMembershipPlans(env.D1_01, creatorId, requestedLimit, url.searchParams.get('cursor'))
        return json({ data: result, requestId: crypto.randomUUID() })
      }
      if (operation.operation === 'listPlans') {
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const result = await listActiveMembershipPlans(env.D1_01, requestedLimit, url.searchParams.get('cursor'))
        return json({ data: result, requestId: crypto.randomUUID() })
      }
      if (operation.operation === 'list') {
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const requestedPage = parseBoundedPositiveInt(url.searchParams.get('page'), 1, 10000)
        const result = await listSubscriptions(env.D1_01, principal, requestedLimit, requestedPage)
        return json({ data: result, requestId: crypto.randomUUID() })
      }
      const result = await getSubscription(env.D1_01, principal, operation.subscriptionId)
      return json({ data: result, requestId: crypto.randomUUID() }, 200, result.etag)
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError) {
        const message = error.code === 'PERMISSION_DENIED' ? 'permission denied' : error.code === 'PRECONDITION_REQUIRED' ? 'precondition required' : error.code === 'PRECONDITION_FAILED' ? 'precondition failed' : error.code === 'RESOURCE_NOT_FOUND' ? 'resource not found' : error.code === 'INVALID_STATE' ? 'invalid subscription state' : error.code === 'PLAN_NOT_ACTIVE' ? 'membership plan is unavailable' : error.code === 'CONFLICT' ? 'subscription conflict' : error.code === 'VALIDATION_FAILED' ? 'validation failed' : error.code === 'RATE_LIMITED' ? 'too many requests' : error.code === 'SERVICE_UNAVAILABLE' ? 'service unavailable' : error.code
        return new Response(JSON.stringify({ error: { code: error.code, message, details: error.code === 'RATE_LIMITED' ? { retryAfter: 60 } : {} }, requestId: crypto.randomUUID() }), { status: error.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(error.code === 'RATE_LIMITED' ? { 'retry-after': '60' } : {}) } })
      }
      console.error(error)
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} }, requestId: crypto.randomUUID() }, 500)
    }
  },
}
