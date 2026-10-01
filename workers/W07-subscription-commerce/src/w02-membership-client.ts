import { getCloudflareContext } from '@opennextjs/cloudflare'

type W02IdentityService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export type W07MembershipCall = {
  correlationId: string
  idempotencyKey: string
  actorUserId: string
  body: Record<string, unknown>
}

export type W02SubscriptionSnapshot = {
  subscriptionId: string
  subscriberId: string
  planId: string
  planVersion: number
  status: 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
  version: number
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAt: string | null
}

export class W02MembershipClientError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function getW02Service(): Promise<W02IdentityService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_IDENTITY?: W02IdentityService }).W02_IDENTITY
  if (!service) throw new W02MembershipClientError(503, 'Identity service unavailable')
  return service
}

export async function callW02Membership(
  input: W07MembershipCall & { operation: 'create' | 'transition' },
): Promise<Response> {
  const service = await getW02Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W07',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.correlationId,
    'X-LuckRead-Principal-User-Id': input.actorUserId,
    'Idempotency-Key': input.idempotencyKey,
    'content-type': 'application/json; charset=utf-8',
  })

  const path = input.operation === 'create'
    ? '/internal/membership/subscriptions'
    : '/internal/membership/subscriptions/transition'

  const response = await service.fetch(new Request(
    'https://luckread-w02.internal' + path,
    { method: 'POST', headers, body: JSON.stringify(input.body) },
  ))

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export async function readW02MembershipSubscription(input: {
  correlationId: string
  actorUserId: string
  subscriptionId: string
}): Promise<W02SubscriptionSnapshot> {
  const service = await getW02Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W07',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Correlation-Id': input.correlationId,
    'X-LuckRead-Principal-User-Id': input.actorUserId,
    'content-type': 'application/json; charset=utf-8',
  })

  const response = await service.fetch(new Request(
    'https://luckread-w02.internal/internal/membership/subscriptions/read',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ subscriptionId: input.subscriptionId }),
    },
  ))

  if (!response.ok) {
    throw new W02MembershipClientError(response.status, 'Membership subscription read denied or unavailable')
  }

  const payload = await response.json() as Partial<W02SubscriptionSnapshot>
  if (
    payload.subscriptionId !== input.subscriptionId ||
    payload.subscriberId !== input.actorUserId ||
    typeof payload.planId !== 'string' ||
    !Number.isSafeInteger(payload.planVersion) ||
    !Number.isSafeInteger(payload.version) ||
    typeof payload.status !== 'string'
  ) {
    throw new W02MembershipClientError(503, 'Invalid authoritative membership snapshot')
  }
  return payload as W02SubscriptionSnapshot
}
