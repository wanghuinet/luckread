import {
  SubscriptionStateError,
  transitionSubscription,
  type SubscriptionStatus,
} from './subscription-state-machine.js'
import { callW02Membership, readW02MembershipSubscription, W02MembershipClientError } from './w02-membership-client.js'
import { deriveW01MembershipTransition } from './w01-transition-boundary.js'

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

    if (url.pathname === '/internal/membership/subscription/read' && request.method === 'POST') {
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0' ||
        !request.headers.get('X-LuckRead-Correlation-Id') ||
        !request.headers.get('X-LuckRead-Principal-User-Id')
      ) {
        return json({ error: { code: 'UNTRUSTED_CALLER' } }, 403)
      }

      let body: { subscriptionId?: unknown }
      try {
        body = await request.json() as typeof body
      } catch {
        return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
      }

      if (typeof body.subscriptionId !== 'string' || body.subscriptionId.length === 0 || body.subscriptionId.length > 128) {
        return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
      }

      try {
        const snapshot = await readW02MembershipSubscription({
          correlationId: request.headers.get('X-LuckRead-Correlation-Id')!,
          actorUserId: request.headers.get('X-LuckRead-Principal-User-Id')!,
          subscriptionId: body.subscriptionId,
        })
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            ETag: `W/"${snapshot.version}"`,
          },
        })
      } catch (error) {
        if (error instanceof W02MembershipClientError) {
          const status = error.status === 404 ? 404 : error.status === 403 ? 403 : 503
          const code = status === 404 ? 'NOT_FOUND' : status === 403 ? 'PERMISSION_DENIED' : 'SERVICE_UNAVAILABLE'
          return json({ error: { code, details: {} } }, status)
        }
        return json({ error: { code: 'SERVICE_UNAVAILABLE', details: {} } }, 503)
      }
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
      expectedVersion?: unknown
      idempotencyKey?: unknown
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

    let w01Transition: ReturnType<typeof deriveW01MembershipTransition>
    try {
      w01Transition = deriveW01MembershipTransition(body.from as SubscriptionStatus, body.to as SubscriptionStatus)
    } catch {
      return json({ error: { code: 'TRANSITION_REQUIRES_TRUSTED_AUTHORITY' } }, 403)
    }

    try {
      const snapshot = await readW02MembershipSubscription({
        correlationId: request.headers.get('X-LuckRead-Correlation-Id')!,
        actorUserId: request.headers.get('X-LuckRead-Principal-User-Id') ?? '',
        subscriptionId: body.subscriptionId,
      })

      if (
        body.from !== snapshot.status ||
        body.expectedVersion !== snapshot.version
      ) {
        return json({ error: { code: 'VERSION_CONFLICT' } }, 412)
      }

      transitionSubscription(
        { status: snapshot.status, version: snapshot.version },
        {
          to: body.to as SubscriptionStatus,
          actor: w01Transition.actor,
          expectedVersion: body.expectedVersion,
          idempotencyKey: body.idempotencyKey,
        },
      )

      const derivedEntitlementAction = w01Transition.entitlementAction

      const accessState = await callW02Membership({
        operation: 'transition',
        correlationId: request.headers.get('X-LuckRead-Correlation-Id')!,
        idempotencyKey: request.headers.get('Idempotency-Key')!,
        actorUserId: request.headers.get('X-LuckRead-Principal-User-Id') ?? '',
        body: {
          subscriptionId: body.subscriptionId,
          from: body.from,
          to: body.to,
          actor: w01Transition.actor,
          expectedVersion: body.expectedVersion,
          entitlementAction: derivedEntitlementAction,
        },
      })

      return new Response(await accessState.arrayBuffer(), {
        status: accessState.status,
        headers: { 'content-type': accessState.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    } catch (error) {
      if (error instanceof W02MembershipClientError) {
        const code =
          error.status === 403 ? 'ACCESS_DENIED' :
          error.status === 404 ? 'NOT_FOUND' :
          error.status === 409 ? 'INVALID_STATE' :
          error.status === 412 ? 'VERSION_CONFLICT' :
          'SERVICE_UNAVAILABLE'
        const status =
          error.status === 403 || error.status === 404 || error.status === 409 || error.status === 412
            ? error.status
            : 503
        return json({ error: { code, details: {} } }, status)
      }

      const code = error instanceof SubscriptionStateError ? error.code : 'SERVICE_UNAVAILABLE'
      const status =
        code === 'VERSION_CONFLICT' ? 412 :
        code === 'INVALID_STATE_TRANSITION' ? 409 :
        400
      return json({ error: { code, details: {} } }, status)
    }
  },
}
