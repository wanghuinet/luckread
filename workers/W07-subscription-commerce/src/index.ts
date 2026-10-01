import {
  SubscriptionStateError,
  transitionSubscription,
  type SubscriptionActor,
  type SubscriptionStatus,
} from './subscription-state-machine.js'
import { callW02Membership } from './w02-membership-client.js'

const actors = new Set<SubscriptionActor>(['system', 'payment', 'user', 'creator', 'admin'])
const statuses = new Set<SubscriptionStatus>(['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'])

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  },
})

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return json({ worker: 'luckread-w07', status: 'ok' })
    }

    if (url.pathname === '/internal/membership/subscriptions' && request.method === 'POST') {
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
        !request.headers.get('X-LuckRead-Correlation-Id') ||
        !request.headers.get('Idempotency-Key')
      ) {
        return json({ error: { code: 'UNTRUSTED_CALLER' } }, 403)
      }

      let body: {
        subscriptionId?: unknown
        subscriberId?: unknown
        planId?: unknown
        planVersion?: unknown
        startedAt?: unknown
        currentPeriodStart?: unknown
        currentPeriodEnd?: unknown
      }

      try {
        body = await request.json() as typeof body
      } catch {
        return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
      }

      const actorUserId = request.headers.get('X-LuckRead-Principal-User-Id') ?? ''
      if (
        typeof body.subscriptionId !== 'string' ||
        typeof body.subscriberId !== 'string' ||
        typeof body.planId !== 'string' ||
        typeof body.planVersion !== 'number' ||
        typeof body.startedAt !== 'string' ||
        typeof body.currentPeriodStart !== 'string' ||
        typeof body.currentPeriodEnd !== 'string' ||
        actorUserId !== body.subscriberId
      ) {
        return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
      }

      try {
        const response = await callW02Membership({
          operation: 'create',
          correlationId: request.headers.get('X-LuckRead-Correlation-Id')!,
          idempotencyKey: request.headers.get('Idempotency-Key')!,
          actorUserId,
          body: {
            subscriptionId: body.subscriptionId,
            subscriberId: body.subscriberId,
            planId: body.planId,
            planVersion: body.planVersion,
            startedAt: body.startedAt,
            currentPeriodStart: body.currentPeriodStart,
            currentPeriodEnd: body.currentPeriodEnd,
          },
        })
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          headers: { 'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        })
      } catch (error) {
        const status = error instanceof Error && 'status' in error ? Number((error as { status?: number }).status) : 503
        return json({ error: { code: status === 403 ? 'ACCESS_DENIED' : 'SERVICE_UNAVAILABLE' } }, status === 403 ? 403 : 503)
      }
    }

    if (url.pathname !== '/internal/membership/subscription/transition' || request.method !== 'POST') {
      return new Response(null, { status: 404 })
    }

    if (
      request.headers.get('X-LuckRead-Caller') !== 'W01' ||
      request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
      !request.headers.get('X-LuckRead-Correlation-Id')
    ) {
      return json({ error: { code: 'UNTRUSTED_CALLER' } }, 403)
    }

    let body: {
      subscriptionId?: unknown
      from?: unknown
      to?: unknown
      actor?: unknown
      expectedVersion?: unknown
      idempotencyKey?: unknown
      entitlementAction?: unknown
      entitlementId?: unknown
      entitlementType?: unknown
      scopeType?: unknown
      scopeId?: unknown
      sourcePlanVersion?: unknown
      effectiveAt?: unknown
      expiresAt?: unknown
    }

    try {
      body = await request.json() as typeof body
    } catch {
      return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    }

    if (
      typeof body.subscriptionId !== 'string' ||
      typeof body.from !== 'string' ||
      !statuses.has(body.from as SubscriptionStatus) ||
      typeof body.to !== 'string' ||
      !statuses.has(body.to as SubscriptionStatus) ||
      typeof body.expectedVersion !== 'number' ||
      !Number.isSafeInteger(body.expectedVersion) ||
      typeof body.idempotencyKey !== 'string' ||
      body.idempotencyKey !== request.headers.get('Idempotency-Key')
    ) {
      return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    }

    if (body.to === 'ACTIVE' || body.from !== 'ACTIVE' || body.to !== 'CANCELED') {
      return json({ error: { code: 'TRANSITION_REQUIRES_TRUSTED_AUTHORITY' } }, 403)
    }

    const state = request.headers.get('X-LuckRead-Subscription-State') as SubscriptionStatus | null
    const version = Number(request.headers.get('X-LuckRead-Subscription-Version') ?? '1')

    if (!state || !statuses.has(state) || body.from !== state || !Number.isSafeInteger(version) || version < 1 || body.expectedVersion !== version) {
      return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    }

    try {
      transitionSubscription(
        { status: state, version },
        {
          to: body.to as SubscriptionStatus,
          actor: 'user',
          expectedVersion: body.expectedVersion,
          idempotencyKey: body.idempotencyKey,
        },
      )

      const derivedEntitlementAction =
        body.to === 'CANCELED' ? 'REVOKE' : 'NONE'

      const accessState = await callW02Membership({
        operation: 'transition',
        correlationId: request.headers.get('X-LuckRead-Correlation-Id')!,
        idempotencyKey: request.headers.get('Idempotency-Key')!,
        actorUserId: request.headers.get('X-LuckRead-Principal-User-Id') ?? '',
        body: {
          subscriptionId: body.subscriptionId,
          from: body.from,
          to: body.to,
          actor: 'user',
          expectedVersion: body.expectedVersion,
          entitlementAction: derivedEntitlementAction,
          entitlementId: typeof body.entitlementId === 'string' ? body.entitlementId : undefined,
          entitlementType: typeof body.entitlementType === 'string' ? body.entitlementType : undefined,
          scopeType: typeof body.scopeType === 'string' ? body.scopeType : undefined,
          scopeId: typeof body.scopeId === 'string' ? body.scopeId : undefined,
          sourcePlanVersion: typeof body.sourcePlanVersion === 'number' ? body.sourcePlanVersion : undefined,
          effectiveAt: typeof body.effectiveAt === 'string' ? body.effectiveAt : undefined,
          expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : null,
        },
      })

      return new Response(await accessState.arrayBuffer(), {
        status: accessState.status,
        headers: { 'content-type': accessState.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    } catch (error) {
      const code = error instanceof SubscriptionStateError ? error.code : 'SERVICE_UNAVAILABLE'
      const status = code === 'VERSION_CONFLICT' ? 412 : code === 'INVALID_STATE_TRANSITION' ? 409 : 400
      return json({ error: { code, details: {} } }, status)
    }
  },
}
