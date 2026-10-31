/// <reference types="@cloudflare/workers-types" />

import { quoteSubscriptionPlanChange } from './subscription-plan-change-quote.js'
import { createSubscriptionPlanUpgradeOrder } from './subscription-plan-change-checkout.js'
import { scheduleSubscriptionPlanChangeAtPeriodEnd } from './subscription-plan-change-schedule.js'
import { createMembershipPlanDraft, reviseMembershipPlan, getSubscription, hasActiveCreatorMembership, listActiveMembershipPlans, listCreatorMembershipPlans, listSubscriptions, parseBoundedPositiveInt, publishMembershipPlan, transitionMembershipPlanLifecycle, SubscriptionRuntimeError, validatePrincipal } from './subscription-runtime.js'
import { handleCommerceOrderRequest } from './order-http-runtime.js'
import { resolveCommerceOrderItems } from './order-item-resolution.js'
import { applyDemoTaxPricing, isDemoPricingEnabled } from './demo-tax-pricing.js'
import { applyTaxJarSandboxPricing } from './taxjar-sandbox-pricing.js'
import { handleCommercePaymentIntentRequest } from './payment-intent-http-runtime.js'
import { handleCommerceRefundRequest } from './refund-http-runtime.js'
import { handleCommerceBillingReadRequest } from './billing-read-http-runtime.js'
import { handleHyperswitchWebhookRequest } from './payment-webhook-http-runtime.js'
import { handleRevenueCatWebhookRequest } from './revenuecat-webhook-http-runtime.js'
import { handleRevenueCatSubscriberReconciliationRequest } from './revenuecat-subscriber-reconciliation-runtime.js'

interface RateLimitBinding { limit(input: { key: string }): Promise<{ success: boolean }> }
interface Env {
  D1_01: D1Database
  D1_04: D1Database
  HYPERSWITCH_ENVIRONMENT?: string
  COMMERCE_PRICING_MODE?: string
  HYPERSWITCH_API_KEY?: string
  HYPERSWITCH_MERCHANT_ID?: string
  HYPERSWITCH_WEBHOOK_SECRET?: string
  REVENUECAT_WEBHOOK_AUTHORIZATION?: string
  REVENUECAT_WEBHOOK_SIGNING_SECRET?: string
  REVENUECAT_ALLOWED_APP_IDS?: string
  REVENUECAT_SECRET_API_KEY?: string
  COMMERCE_DEMO_TAX_PROVIDER?: string
  TAXJAR_SANDBOX_API_KEY?: string
  TAXJAR_DEMO_FROM_STREET?: string
  TAXJAR_DEMO_FROM_CITY?: string
  TAXJAR_DEMO_FROM_STATE?: string
  TAXJAR_DEMO_FROM_ZIP?: string
  TAXJAR_DEMO_TO_STREET?: string
  TAXJAR_DEMO_TO_CITY?: string
  TAXJAR_DEMO_TO_STATE?: string
  TAXJAR_DEMO_TO_ZIP?: string
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

const enforceRateLimit = async (request: Request, env: Env, operationOverride?: 'read' | 'write'): Promise<void> => {
  const operation = operationOverride ?? (request.method === 'GET' ? 'read' : 'write')
  const originLimiter = env.SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER
  if (!originLimiter) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  await applyRateLimit(originLimiter, 'origin:' + operation)

  const actorLimiter = operation === 'read' ? env.SUBSCRIPTION_READ_LIMITER : env.SUBSCRIPTION_WRITE_LIMITER
  if (!actorLimiter) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
  await applyRateLimit(actorLimiter, operation + ':' + getRateKey(request))
}

const json = (body: unknown, status = 200, etag?: string) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(etag ? { ETag: etag } : {}) } })

const requireTransport = (request: Request, expectedCaller = 'W01'): void => {
  if (request.headers.get('X-LuckRead-Caller') !== expectedCaller || request.headers.get('X-LuckRead-Transport-Version') !== '1.0' || !request.headers.get('X-LuckRead-Correlation-Id')?.trim()) throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
}

const requirePrincipal = (request: Request): string => { requireTransport(request); return validatePrincipal(request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? '') }

const requireLayer = (request: Request): void => {
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (!/^L[0-8]$/.test(layer) || Number(layer.slice(1)) < 2) throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
}

const parseSegments = (pathname: string): string[] => pathname.split('/').filter(Boolean).map((segment) => { try { return decodeURIComponent(segment) } catch { throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400) } })

const requireCreatorLayer = (request: Request): void => {
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  if (!/^L[0-8]$/.test(layer) || Number(layer.slice(1)) < 3) {
    throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
  }
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
  | { operation: 'quotePlanChange'; subscriptionId: string }
  | { operation: 'changePlan'; subscriptionId: string }
  | { operation: 'schedulePlanChange'; subscriptionId: string }

const toOperation = (method: string, segments: string[]): Operation | null => {
  if (segments.length === 1 && segments[0] === 'plans' && method === 'GET') return { operation: 'listPlans', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'membership' && segments[1] === 'plans' && method === 'GET') return { operation: 'listOwnedPlans', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'membership' && segments[1] === 'plans' && method === 'POST') return { operation: 'createPlan', subscriptionId: null }
  if (segments.length === 2 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'list', subscriptionId: null }
  if (segments.length === 3 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && method === 'GET') return { operation: 'get', subscriptionId: segments[2] }
  if (segments.length === 5 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && segments[3] === 'change-plan' && segments[4] === 'quote' && method === 'GET') return { operation: 'quotePlanChange', subscriptionId: segments[2] }
  if (segments.length === 5 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && segments[3] === 'change-plan' && segments[4] === 'schedule' && method === 'POST') return { operation: 'schedulePlanChange', subscriptionId: segments[2] }
  if (segments.length === 4 && segments[0] === 'memberships' && segments[1] === 'subscriptions' && segments[3] === 'change-plan' && method === 'POST') return { operation: 'changePlan', subscriptionId: segments[2] }
  return null
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      // Provider webhooks have no user session. Apply the existing global write
      // limiter and validate the private W01 transport before normal principal
      // and layer checks; do not introduce a new rate-limit namespace.
      if (new URL(request.url).pathname === '/internal/webhooks/hyperswitch') {
        const originLimiter = env.SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER
        if (!originLimiter) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
        await applyRateLimit(originLimiter, 'origin:webhook')
        const webhookResponse = await handleHyperswitchWebhookRequest(request, env)
        if (webhookResponse) return webhookResponse
      }

      if (new URL(request.url).pathname === '/internal/webhooks/revenuecat') {
        const originLimiter = env.SUBSCRIPTION_ORIGIN_GLOBAL_LIMITER
        if (!originLimiter) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
        await applyRateLimit(originLimiter, 'origin:webhook')
        const webhookResponse = await handleRevenueCatWebhookRequest(request, env)
        if (webhookResponse) return webhookResponse
      }

      if (new URL(request.url).pathname === '/internal/subscriptions/reconcile-revenuecat') {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        await enforceRateLimit(request, env, 'read')
        requireTransport(request, 'W01')
        if (request.headers.has('Authorization') || request.headers.has('Cookie')) {
          throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
        }
        requirePrincipal(request)
        requireLayer(request)
        const reconciliationResponse = await handleRevenueCatSubscriberReconciliationRequest(request, env)
        if (reconciliationResponse) return reconciliationResponse
      }

      // W03 may ask for a bounded membership decision; this endpoint never
      // returns subscription, plan, payment, order, or financial records.
      if (new URL(request.url).pathname === '/internal/entitlements/check-creator-membership') {
        if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
        await enforceRateLimit(request, env, 'read')
        requireTransport(request, 'W03')
        if (request.headers.has('Authorization') || request.headers.has('Cookie')) {
          throw new SubscriptionRuntimeError('PERMISSION_DENIED', 403)
        }
        const subscriberId = validatePrincipal(request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? '')
        requireLayer(request)
        const input = await readJsonBody(request)
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input as Record<string, unknown>).length !== 1 ||
            !Object.hasOwn(input, 'creatorId') ||
            typeof (input as { creatorId?: unknown }).creatorId !== 'string') {
          throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        }
        const creatorId = validatePrincipal((input as { creatorId: string }).creatorId)
        const allowed = await hasActiveCreatorMembership(env.D1_01, subscriberId, creatorId)
        return json({
          data: { allowed, reason: allowed ? 'ACTIVE_CREATOR_MEMBERSHIP' : 'MEMBERSHIP_REQUIRED' },
          requestId: `req_${crypto.randomUUID()}`,
        })
      }

      await enforceRateLimit(request, env)
      requireTransport(request)
      const principal = requirePrincipal(request)
      requireLayer(request)
      const paymentIntentResponse = await handleCommercePaymentIntentRequest(request, principal, env)
      if (paymentIntentResponse) return paymentIntentResponse
      const billingReadResponse = await handleCommerceBillingReadRequest(request, principal, env)
      if (billingReadResponse) return billingReadResponse
      const refundResponse = await handleCommerceRefundRequest(request, principal, env)
      if (refundResponse) return refundResponse
      const orderDependencies = isDemoPricingEnabled(env.COMMERCE_PRICING_MODE, env.HYPERSWITCH_ENVIRONMENT)
        ? {
            resolvePricing: async (input: unknown) => {
              const resolved = await resolveCommerceOrderItems(env.D1_01, input)
              if (env.COMMERCE_DEMO_TAX_PROVIDER === 'synthetic') {
                return applyDemoTaxPricing(resolved)
              }
              if (env.COMMERCE_DEMO_TAX_PROVIDER === 'taxjar-sandbox') {
                try {
                  return await applyTaxJarSandboxPricing(resolved, {
                    apiKey: env.TAXJAR_SANDBOX_API_KEY,
                    fromAddress: {
                      street: env.TAXJAR_DEMO_FROM_STREET ?? '',
                      city: env.TAXJAR_DEMO_FROM_CITY ?? '',
                      state: env.TAXJAR_DEMO_FROM_STATE ?? '',
                      zip: env.TAXJAR_DEMO_FROM_ZIP ?? '',
                    },
                    toAddress: {
                      street: env.TAXJAR_DEMO_TO_STREET ?? '',
                      city: env.TAXJAR_DEMO_TO_CITY ?? '',
                      state: env.TAXJAR_DEMO_TO_STATE ?? '',
                      zip: env.TAXJAR_DEMO_TO_ZIP ?? '',
                    },
                  })
                } catch {
                  throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
                }
              }
              // Tax provider must be selected explicitly; never silently substitute
              // a synthetic tax amount when the provider is missing or misspelled.
              throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503)
            },
          }
        : undefined
      const commerceOrderResponse = await handleCommerceOrderRequest(request, principal, env, orderDependencies)
      if (commerceOrderResponse) return commerceOrderResponse
      const pathname = new URL(request.url).pathname
      const operation = toOperation(request.method, parseSegments(pathname))
      const publishPathMatch = /^\/membership\/plans\/([^/]+)\/publish$/.exec(pathname)
      if (request.method === 'POST' && publishPathMatch) {
        const segments = parseSegments(pathname)
        if (segments.length !== 4 || segments[0] !== 'membership' || segments[1] !== 'plans' || segments[3] !== 'publish') {
          return new Response(null, { status: 404 })
        }
        if (request.body !== null) {
          await request.body.cancel().catch(() => undefined)
          return json({ error: { code: 'VALIDATION_FAILED', message: 'Plan publish does not accept a request body', details: {} }, requestId: `req_${crypto.randomUUID()}` }, 400)
        }
        requireCreatorLayer(request)
        const creatorId = requireVerifiedCreatorId(request)
        const result = await publishMembershipPlan(env.D1_01, creatorId, segments[2]!, request.headers.get('If-Match'))
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, 200, result.etag)
      }
      const planRevisionMatch = /^\/membership\/plans\/([^/]+)$/.exec(pathname)
      if (request.method === 'PUT' && planRevisionMatch) {
        const segments = parseSegments(pathname)
        if (segments.length !== 3 || segments[0] !== 'membership' || segments[1] !== 'plans') {
          return new Response(null, { status: 404 })
        }
        requireCreatorLayer(request)
        const creatorId = requireVerifiedCreatorId(request)
        const input = await readJsonBody(request)
        const result = await reviseMembershipPlan(
          env.D1_01, creatorId, segments[2]!, request.headers.get('If-Match'), input,
        )
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, 200, result.etag)
      }
      const planLifecycleMatch = /^\/membership\/plans\/([^/]+)\/lifecycle$/.exec(pathname)
      if (request.method === 'POST' && planLifecycleMatch) {
        const segments = parseSegments(pathname)
        if (segments.length !== 4 || segments[0] !== 'membership' || segments[1] !== 'plans' || segments[3] !== 'lifecycle') {
          return new Response(null, { status: 404 })
        }
        requireCreatorLayer(request)
        const creatorId = requireVerifiedCreatorId(request)
        const value = await readJsonBody(request)
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value as Record<string, unknown>).length !== 1 ||
            !Object.hasOwn(value, 'action') ||
            !['pause', 'resume', 'retire'].includes(String((value as Record<string, unknown>).action))) {
          throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        }
        const result = await transitionMembershipPlanLifecycle(
          env.D1_01, creatorId, segments[2]!, request.headers.get('If-Match'),
          (value as { action: 'pause' | 'resume' | 'retire' }).action,
        )
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, 200, result.etag)
      }
      if (operation?.operation === 'schedulePlanChange') {
        const value = await readJsonBody(request)
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value as Record<string, unknown>).length !== 1 ||
            !Object.hasOwn(value, 'planId') ||
            typeof (value as { planId?: unknown }).planId !== 'string') {
          throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        }
        const result = await scheduleSubscriptionPlanChangeAtPeriodEnd(env, principal, {
          subscriptionId: operation.subscriptionId,
          planId: (value as { planId: string }).planId,
          ifMatch: request.headers.get('If-Match') ?? '',
          idempotencyKey: request.headers.get('Idempotency-Key') ?? '',
          actorLayer: request.headers.get('X-LuckRead-Principal-Layer') ?? '',
        })
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, result.replayed ? 200 : 201)
      }
      if (operation?.operation === 'changePlan') {
        const value = await readJsonBody(request)
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value as Record<string, unknown>).length !== 1 ||
            !Object.hasOwn(value, 'planId') ||
            typeof (value as { planId?: unknown }).planId !== 'string') {
          throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        }
        const result = await createSubscriptionPlanUpgradeOrder(env, principal, {
          subscriptionId: operation.subscriptionId,
          planId: (value as { planId: string }).planId,
          ifMatch: request.headers.get('If-Match') ?? '',
          idempotencyKey: request.headers.get('Idempotency-Key') ?? '',
          actorLayer: request.headers.get('X-LuckRead-Principal-Layer') ?? '',
        })
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, result.replayed ? 200 : 201)
      }
      if (request.method === 'POST' && operation?.operation !== 'createPlan') {
        return json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Subscription writes are disabled until verified payment-provider synchronization is available.',
            details: {},
          },
          requestId: `req_${crypto.randomUUID()}`,
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
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, result.replayed ? 200 : 201, result.etag)
      }
      if (operation.operation === 'listOwnedPlans') {
        requireCreatorLayer(request)
        const creatorId = requireVerifiedCreatorId(request)
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const result = await listCreatorMembershipPlans(env.D1_01, creatorId, requestedLimit, url.searchParams.get('cursor'))
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` })
      }
      if (operation.operation === 'listPlans') {
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const result = await listActiveMembershipPlans(env.D1_01, requestedLimit, url.searchParams.get('cursor'))
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` })
      }
      if (operation.operation === 'list') {
        const url = new URL(request.url)
        const requestedLimit = parseBoundedPositiveInt(url.searchParams.get('limit'), 20, 50)
        const requestedPage = parseBoundedPositiveInt(url.searchParams.get('page'), 1, 10000)
        const result = await listSubscriptions(env.D1_01, principal, requestedLimit, requestedPage)
        return json({ data: result, requestId: `req_${crypto.randomUUID()}` })
      }
      if (operation.operation === 'quotePlanChange') {
        const url = new URL(request.url)
        const planId = url.searchParams.get('planId')
        if (!planId) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400)
        const quote = await quoteSubscriptionPlanChange(
          env.D1_01, principal, operation.subscriptionId, { planId }, request.headers.get('If-Match') ?? '',
        )
        return json({ data: quote, requestId: `req_${crypto.randomUUID()}` })
      }
      const result = await getSubscription(env.D1_01, principal, operation.subscriptionId)
      return json({ data: result, requestId: `req_${crypto.randomUUID()}` }, 200, result.etag)
    } catch (error) {
      if (error instanceof SubscriptionRuntimeError) {
        const message = error.code === 'PERMISSION_DENIED' ? 'permission denied' : error.code === 'PRECONDITION_REQUIRED' ? 'precondition required' : error.code === 'PRECONDITION_FAILED' ? 'precondition failed' : error.code === 'RESOURCE_NOT_FOUND' ? 'resource not found' : error.code === 'INVALID_STATE' ? 'invalid subscription state' : error.code === 'PLAN_NOT_ACTIVE' ? 'membership plan is unavailable' : error.code === 'CONFLICT' ? 'subscription conflict' : error.code === 'VALIDATION_FAILED' ? 'validation failed' : error.code === 'RATE_LIMITED' ? 'too many requests' : error.code === 'SERVICE_UNAVAILABLE' ? 'service unavailable' : error.code
        return new Response(JSON.stringify({ error: { code: error.code, message, details: error.code === 'RATE_LIMITED' ? { retryAfter: 60 } : {} }, requestId: `req_${crypto.randomUUID()}` }), { status: error.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(error.code === 'RATE_LIMITED' ? { 'retry-after': '60' } : {}) } })
      }
      console.error(error)
      return json({ error: { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} }, requestId: `req_${crypto.randomUUID()}` }, 500)
    }
  },
}
