/// <reference types="@cloudflare/workers-types" />

import { changeSubscriptionPlan, createSubscription, getSubscription, listSubscriptions, parseBoundedPositiveInt, SubscriptionRuntimeError, transitionSubscription, validateIfMatch, validateIdempotencyKey, validatePrincipal } from './subscription-runtime.js'

interface RateLimitBinding { limit(input: { key: string }): Promise<{ success: boolean }> }
interface Env {
  D1_01: D1Database
  SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER?: RateLimitBinding
  SUBSCRIPTION_READ_LIMITER?: RateLimitBinding
  SUBSCRIPTION_WRITE_LIMITER?: RateLimitBinding
}

const getRateKey = (request: Request): string =>
  request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ||
  request.headers.get('X-LuckRead-Client-IP')?.trim() ||
  'transport:W01'

const enforceRateLimit = async (request: Request, env: Env): Promise<void> => {
  const operation = request.method === 'GET' ? 'read' : 'write'
  if (env.SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER) {
    const result = await env.SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER.limit({ key: 'origin:' + operation })
    if (!result.success) throw new SubscriptionRuntimeError('RATE_LIMITED', 429)
  }
  const actorLimiter = operation === 'read' ? env.SUBSCRIPTION_READ_LIMITER : env.SUBSCRIPTION_WRITE_LIMITER
  if (actorLimiter) {
    const result = await actorLimiter.limit({ key: operation + ':' + getRateKey(request) })
    if (!result.success) throw new SubscriptionRuntimeError('RATE_LIMITED', 429)
  }
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

const readJson = async <T>(request: Request): Promise<T> => {
  try {
    const value = await request.json() as T
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
    return value
  } catch { throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400) }
}

const parseSegments = (pathname: string): string[] => pathname.split('/').filter(Boolean).map((segment) => { try { return decodeURIComponent(segment) } catch { throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400) } })

type Operation =
  | { operation: 'create'; subscriptionId: null }
  | { operation: 'list'; subscriptionId: null }
  | { operation: 'get'; subscriptionId: string }
  | { operation: 'cancel'; subscriptionId: string }
  | { operation: 'pause'; subscriptionId: string }
  | { operation: 'resume'; subscriptionId: string }
  | { operation: 'change-plan'; subscriptionId: string }

type MutationOperation = 'cancel' | 'pause' | 'resume' | 'change-plan'
const mutationOperations: readonly MutationOperation[] = ['cancel', 'pause', 'resume', 'change-plan']
const isMutationOperation = (value: string): value is MutationOperation => mutationOperations.includes(value as MutationOperation)

const toOperation = (method: string, segments: string[]): Operation | null => {
  if (segments.length === 2 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'list', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'POST') return { operation: 'create', subscriptionId: null }
  if (segments.length === 3 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'get', subscriptionId: segments[2] }
  if (segments.length === 4 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'POST' && isMutationOperation(segments[3])) return { operation: segments[3], subscriptionId: segments[2] }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await enforceRateLimit(request, env)
      requireTransport(request)
      const operation = toOperation(request.method, parseSegments(new URL(request.url).pathname))
      if (!operation) return new Response(null, { status: 404 })
      const principal = requirePrincipal(request)
      requireLayer(request)
      if (isMutationOperation(operation.operation)) validateIdempotencyKey(request.headers.get('Idempotency-Key'))

      if (operation.operation === 'create') {
        const idempotencyKey = validateIdempotencyKey(request.headers.get('Idempotency-Key'))
        const body = await readJson<{ planId?: unknown }>(request)
        if (typeof body.planId !== 'string') throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        const result = await createSubscription(env.D1_01, principal, { planId: body.planId, idempotencyKey })
        return json({ data: result, requestId: crypto.randomUUID() }, 201, result.etag)
      }
      if (operation.operation === 'list') {
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const requestedPage = parseBoundedPositiveInt(url.searchParams.get('page'), 1, 10000)
        const result = await listSubscriptions(env.D1_01, principal, requestedLimit, requestedPage)
        return json({ data: result, requestId: crypto.randomUUID() })
      }
      if (operation.operation === 'get') {
        const result = await getSubscription(env.D1_01, principal, operation.subscriptionId)
        return json({ data: result, requestId: crypto.randomUUID() }, 200, result.etag)
      }
      const ifMatch = validateIfMatch(request.headers.get('If-Match'))
      if (operation.operation === 'change-plan') {
        const body = await readJson<{ planId?: unknown }>(request)
        if (typeof body.planId !== 'string') throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        const result = await changeSubscriptionPlan(env.D1_01, principal, operation.subscriptionId, body.planId, ifMatch)
        return json({ data: result, requestId: crypto.randomUUID() }, 200, result.etag)
      }
      const result = await transitionSubscription(env.D1_01, principal, operation.subscriptionId, operation.operation, ifMatch)
      return json({ data: result, requestId: crypto.randomUUID() }, 200, result.etag)
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError) {
        const message = error.code === 'PERMISSION_DENIED' ? 'permission denied' : error.code === 'PRECONDITION_REQUIRED' ? 'precondition required' : error.code === 'PRECONDITION_FAILED' ? 'precondition failed' : error.code === 'RESOURCE_NOT_FOUND' ? 'resource not found' : error.code === 'INVALID_STATE' ? 'invalid subscription state' : error.code === 'CONFLICT' ? 'subscription conflict' : error.code === 'VALIDATION_FAILED' ? 'validation failed' : error.code === 'RATE_LIMITED' ? 'too many requests' : error.code
        return new Response(JSON.stringify({ error: { code: error.code, message, details: error.code === 'RATE_LIMITED' ? { retryAfter: 60 } : {} }, requestId: crypto.randomUUID() }), { status: error.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(error.code === 'RATE_LIMITED' ? { 'retry-after': '60' } : {}) } })
      }
      console.error(error)
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} }, requestId: crypto.randomUUID() }, 500)
    }
  },
}
