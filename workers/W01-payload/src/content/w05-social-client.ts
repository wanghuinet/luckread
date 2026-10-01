import { getCloudflareContext } from '@opennextjs/cloudflare'
type W05SocialService = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> }
export type TrustedFollowPolicy = {
  actorAccountState: string
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
async function getW05Service(): Promise<W05SocialService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W05_SOCIAL?: W05SocialService }).W05_SOCIAL
  if (!service) throw new W05SocialClientError(503, 'Social service unavailable')
  return service
}
export async function callW05Follow(input: TrustedFollowRequest & { method: 'POST' | 'DELETE' }): Promise<Response> {
  if (!input.actorUserId || !input.targetUserId || !input.idempotencyKey || !input.correlationId) throw new W05SocialClientError(400, 'Invalid trusted Follow request')
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
        actorAccountState: input.actorAccountState,
        targetFollowability: input.targetFollowability,
        blockPolicyAllows: input.blockPolicyAllows,
        privacyScopeAllows: input.privacyScopeAllows,
        antiAbuseAdmission: input.antiAbuseAdmission,
      }),
    },
  ))
  return new Response(await response.arrayBuffer(), { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
