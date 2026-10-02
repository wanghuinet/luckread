/// <reference types="@cloudflare/workers-types" />

import { changeSubscriptionPlan, createSubscription, getSubscription, SubscriptionRuntimeError, transitionSubscription, validateIfMatch, validateIdempotencyKey, validatePrincipal } from './subscription-runtime.js'

interface Env { D1_01: D1Database }

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

type Operation = { operation: 'create'; subscriptionId: null } | { operation: 'get' | 'cancel' | 'pause' | 'resume' | 'change-plan'; subscriptionId: string }

const toOperation = (method: string, segments: string[]): Operation | null => {
  if (segments.length === 2 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'POST') return { operation: 'create', subscriptionId: null }
  if (segments.length === 3 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'get', subscriptionId: segments[2] }
  if (segments.length === 4 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'POST' && ['cancel', 'pause', 'resume', 'change-plan'].includes(segments[3])) return { operation: segments[3] as Operation['operation'], subscriptionId: segments[2] }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      requireTransport(request)
      const operation = toOperation(request.method, parseSegments(new URL(request.url).pathname))
      if (!operation) return new Response(null, { status: 404 })
      const principal = requirePrincipal(request)
      requireLayer(request)

      if (operation.operation === 'create') {
        const idempotencyKey = validateIdempotencyKey(request.headers.get('Idempotency-Key'))
        const body = await readJson<{ planId?: unknown }>(request)
        if (typeof body.planId !== 'string') throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        const result = await createSubscription(env.D1_01, principal, { planId: body.planId, idempotencyKey })
        return json({ data: result, requestId: crypto.randomUUID() }, 201, result.etag)
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
        const message = error.code === 'PERMISSION_DENIED' ? 'permission denied' : error.code === 'PRECONDITION_REQUIRED' ? 'precondition required' : error.code === 'PRECONDITION_FAILED' ? 'precondition failed' : error.code === 'RESOURCE_NOT_FOUND' ? 'resource not found' : error.code === 'INVALID_STATE' ? 'invalid subscription state' : error.code === 'CONFLICT' ? 'subscription conflict' : error.code === 'VALIDATION_FAILED' ? 'validation failed' : error.code
        return json({ error: { code: error.code, message, details: {} }, requestId: crypto.randomUUID() }, error.status)
      }
      console.error(error)
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} }, requestId: crypto.randomUUID() }, 500)
    }
  },
}
