import {
  SubscriptionStateError,
  transitionSubscription,
  type SubscriptionActor,
  type SubscriptionStatus,
} from './subscription-state-machine.js'

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

    if (url.pathname !== '/internal/membership/subscription/transition' || request.method !== 'POST') {
      return new Response(null, { status: 404 })
    }

    let body: {
      to?: unknown
      actor?: unknown
      expectedVersion?: unknown
      idempotencyKey?: unknown
    }

    try {
      body = await request.json() as typeof body
    } catch {
      return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    }

    if (
      typeof body.to !== 'string' ||
      !statuses.has(body.to as SubscriptionStatus) ||
      typeof body.actor !== 'string' ||
      !actors.has(body.actor as SubscriptionActor) ||
      typeof body.expectedVersion !== 'number' ||
      !Number.isSafeInteger(body.expectedVersion) ||
      typeof body.idempotencyKey !== 'string'
    ) {
      return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    }

    const state = request.headers.get('X-LuckRead-Subscription-State') as SubscriptionStatus | null
    const version = Number(request.headers.get('X-LuckRead-Subscription-Version') ?? '1')

    if (!state || !statuses.has(state) || !Number.isSafeInteger(version) || version < 1) {
      return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    }

    try {
      return json({
        data: transitionSubscription(
          { status: state, version },
          {
            to: body.to as SubscriptionStatus,
            actor: body.actor as SubscriptionActor,
            expectedVersion: body.expectedVersion,
            idempotencyKey: body.idempotencyKey,
          },
        ),
      })
    } catch (error) {
      const code = error instanceof SubscriptionStateError ? error.code : 'SERVICE_UNAVAILABLE'
      const status = code === 'VERSION_CONFLICT' ? 412 : code === 'INVALID_STATE_TRANSITION' ? 409 : 400
      return json({ error: { code, details: {} } }, status)
    }
  },
}
