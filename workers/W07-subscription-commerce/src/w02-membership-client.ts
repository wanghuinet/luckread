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

const subscriptionStatuses = new Set<W02SubscriptionSnapshot['status']>([
  'PENDING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
])

const validTimestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 128 &&
  !Number.isNaN(Date.parse(value))

export class W02MembershipClientError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function parseW02MembershipSnapshot(
  payload: unknown,
  input: { subscriptionId: string; actorUserId: string },
): W02SubscriptionSnapshot {
  if (!payload || typeof payload !== 'object') {
    throw new W02MembershipClientError(503, 'Invalid authoritative membership snapshot')
  }

  const snapshot = payload as Partial<W02SubscriptionSnapshot>
  if (
    snapshot.subscriptionId !== input.subscriptionId ||
    snapshot.subscriberId !== input.actorUserId ||
    typeof snapshot.planId !== 'string' ||
    snapshot.planId.length === 0 ||
    snapshot.planId.length > 128 ||
    !Number.isSafeInteger(snapshot.planVersion) ||
    snapshot.planVersion < 1 ||
    typeof snapshot.status !== 'string' ||
    !subscriptionStatuses.has(snapshot.status as W02SubscriptionSnapshot['status']) ||
    !Number.isSafeInteger(snapshot.version) ||
    snapshot.version < 1 ||
    !validTimestamp(snapshot.currentPeriodStart) ||
    !validTimestamp(snapshot.currentPeriodEnd) ||
    (snapshot.cancelAt !== null && !validTimestamp(snapshot.cancelAt))
  ) {
    throw new W02MembershipClientError(503, 'Invalid authoritative membership snapshot')
  }

  return snapshot as W02SubscriptionSnapshot
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

  const payload = await response.json()
  return parseW02MembershipSnapshot(payload, {
    subscriptionId: input.subscriptionId,
    actorUserId: input.actorUserId,
  })
}
