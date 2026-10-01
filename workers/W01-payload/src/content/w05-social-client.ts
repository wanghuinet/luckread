import { getCloudflareContext } from '@opennextjs/cloudflare'
type W05SocialService = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
type W02AuthService = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
export type TrustedFollowPolicy = {
  targetFollowability: boolean
  blockPolicyAllows: boolean
  privacyScopeAllows: boolean
  antiAbuseAdmission: 'ALLOW' | 'THROTTLE' | 'CHALLENGE' | 'BLOCK' | 'REVIEW'
}
export type TrustedFollowRequest = TrustedFollowPolicy & {
  actorUserId: string
  targetUserId: string
  idempotencyKey: string
  correlationId: string
}
export class W05SocialClientError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
async function getW02Service(): Promise<W02AuthService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W02_AUTH?: W02AuthService }).W02_AUTH
  if (!service) throw new W05SocialClientError(503, 'W02 account-state service unavailable')
  return service
}

async function resolveActorAccountState(input: {
  actorUserId: string
  correlationId: string
}): Promise<string> {
  const response = await (await getW02Service()).fetch(new Request(
    'https://luckread-w02.internal/internal/social/actor-account-state',
    {
      method: 'POST',
      headers: new Headers({
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Principal-User-Id': input.actorUserId,
        'X-LuckRead-Correlation-Id': input.correlationId,
        'content-type': 'application/json; charset=utf-8',
      }),
      body: JSON.stringify({ userId: input.actorUserId }),
    },
  ))
  if (!response.ok) {
    throw new W05SocialClientError(
      response.status === 403 ? 403 : response.status === 404 ? 404 : 503,
      'W02 account-state authority denied or unavailable',
    )
  }
  const payload = await response.json() as { userId?: unknown; accountState?: unknown }
  if (payload.userId !== input.actorUserId || typeof payload.accountState !== 'string') {
    throw new W05SocialClientError(503, 'Invalid W02 account-state authority response')
  }
  return payload.accountState
}

async function getW05Service(): Promise<W05SocialService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W05_SOCIAL?: W05SocialService }).W05_SOCIAL
  if (!service) throw new W05SocialClientError(503, 'Social service unavailable')
  return service
}

export type TrustedLikePolicy = {
  resourceVisible: boolean
  resourceInteractable: boolean
  blockPolicyAllows: boolean
  mutePolicyAllows: boolean
  antiAbuseAdmission: 'ALLOW' | 'THROTTLE' | 'CHALLENGE' | 'BLOCK' | 'REVIEW'
}

export type TrustedLikeRequest = TrustedLikePolicy & {
  actorUserId: string
  resourceId: string
  idempotencyKey: string
  correlationId: string
}

export async function callW05Like(
  input: TrustedLikeRequest & { method: 'POST' | 'DELETE' },
): Promise<Response> {
  if (!input.actorUserId || !input.resourceId || !input.idempotencyKey || !input.correlationId) {
    throw new W05SocialClientError(400, 'Invalid trusted Like request')
  }

  const actorAccountState = await resolveActorAccountState({
    actorUserId: input.actorUserId,
    correlationId: input.correlationId,
  })

  const response = await (await getW05Service()).fetch(new Request(
    'https://luckread-w05.internal/internal/social/likes',
    {
      method: input.method,
      headers: new Headers({
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Principal-User-Id': input.actorUserId,
        'X-LuckRead-Correlation-Id': input.correlationId,
        'Idempotency-Key': input.idempotencyKey,
        'content-type': 'application/json; charset=utf-8',
      }),
      body: JSON.stringify({
        resourceType: 'content',
        resourceId: input.resourceId,
        actorAccountState,
        resourceVisible: input.resourceVisible,
        resourceInteractable: input.resourceInteractable,
        blockPolicyAllows: input.blockPolicyAllows,
        mutePolicyAllows: input.mutePolicyAllows,
        antiAbuseAdmission: input.antiAbuseAdmission,
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

export async function callW05Follow(input: TrustedFollowRequest & { method: 'POST' | 'DELETE' }): Promise<Response> {
  if (!input.actorUserId || !input.targetUserId || !input.idempotencyKey || !input.correlationId) throw new W05SocialClientError(400, 'Invalid trusted Follow request')
  const actorAccountState = await resolveActorAccountState({
    actorUserId: input.actorUserId,
    correlationId: input.correlationId,
  })
  const response = await (await getW05Service()).fetch(new Request(
    'https://luckread-w05.internal/internal/social/follows',
    {
      method: input.method,
      headers: new Headers({
        'X-LuckRead-Caller': 'W01',
        'X-LuckRead-Transport-Version': '1.0',
        'X-LuckRead-Principal-User-Id': input.actorUserId,
        'X-LuckRead-Correlation-Id': input.correlationId,
        'Idempotency-Key': input.idempotencyKey,
        'content-type': 'application/json; charset=utf-8',
      }),
      body: JSON.stringify({
        targetUserId: input.targetUserId,
        actorAccountState,
        targetFollowability: input.targetFollowability,
        blockPolicyAllows: input.blockPolicyAllows,
        privacyScopeAllows: input.privacyScopeAllows,
        antiAbuseAdmission: input.antiAbuseAdmission,
      }),
    },
  ))
  return new Response(await response.arrayBuffer(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
