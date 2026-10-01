import { getCloudflareContext } from '@opennextjs/cloudflare'

type W07MembershipService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W07MembershipClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function getW07Service(): Promise<W07MembershipService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W07_MEMBERSHIP?: W07MembershipService }).W07_MEMBERSHIP
  if (!service) throw new W07MembershipClientError(503, 'Membership service unavailable')
  return service
}

export async function readMembershipSubscription(input: {
  request: Request
  actorUserId: string
  subscriptionId: string
}): Promise<Response> {
  const service = await getW07Service()
  const correlationId = input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID()
  const response = await service.fetch(new Request(
    'https://luckread-w07.internal/internal/membership/subscription/read',
    {
      method: 'POST',
      headers: new Headers({
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Principal-User-Id': input.actorUserId,
        'X-LuckRead-Correlation-Id': correlationId,
        'content-type': 'application/json; charset=utf-8',
      }),
      body: JSON.stringify({ subscriptionId: input.subscriptionId }),
    },
  ))

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
    },
  })
}


export async function transitionMembershipSubscription(input: {
  request: Request
  actorUserId: string
  subscriptionId: string
  from: 'ACTIVE'
  expectedVersion: number
  idempotencyKey: string
}): Promise<Response> {
  const service = await getW07Service()
  const correlationId = input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID()
  const response = await service.fetch(new Request(
    'https://luckread-w07.internal/internal/membership/subscription/transition',
    {
      method: 'POST',
      headers: new Headers({
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Principal-User-Id': input.actorUserId,
        'X-LuckRead-Correlation-Id': correlationId,
        'Idempotency-Key': input.idempotencyKey,
        'content-type': 'application/json; charset=utf-8',
      }),
      body: JSON.stringify({
        subscriptionId: input.subscriptionId,
        from: input.from,
        to: 'CANCELED',
        expectedVersion: input.expectedVersion,
        idempotencyKey: input.idempotencyKey,
      }),
    },
  ))

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
