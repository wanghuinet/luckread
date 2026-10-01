import { followUser, mapFollowError, unfollowUser, type AntiAbuseAdmission, type TrustedFollowAdmission } from './follow-runtime.js'
import { likeResource, mapLikeError, unlikeResource, type TrustedLikeAdmission } from './like-runtime.js'
interface Env { DB: D1Database }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } })
const isAntiAbuseAdmission = (value: unknown): value is AntiAbuseAdmission =>
  value === 'ALLOW' || value === 'THROTTLE' || value === 'CHALLENGE' || value === 'BLOCK' || value === 'REVIEW'
async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch { return null }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/health') return json({ worker: 'luckread-w05', status: 'ok' })
    if (url.pathname === '/internal/social/likes') {
      if (request.method !== 'POST' && request.method !== 'DELETE') {
        return json({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405)
      }
      const body = await readBody(request)
      if (!body) return json({ error: { code: 'VALIDATION_FAILED' } }, 400)

      const trusted: TrustedLikeAdmission = {
        caller: request.headers.get('X-LuckRead-Caller') ?? '',
        transportVersion: request.headers.get('X-LuckRead-Transport-Version') ?? '',
        actorUserId: request.headers.get('X-LuckRead-Principal-User-Id') ?? '',
        correlationId: request.headers.get('X-LuckRead-Correlation-Id') ?? '',
        idempotencyKey: request.headers.get('Idempotency-Key') ?? '',
        resourceType: body.resourceType === 'content' ? 'content' : 'content',
        resourceId: typeof body.resourceId === 'string' ? body.resourceId : '',
        actorAccountState: typeof body.actorAccountState === 'string' ? body.actorAccountState : '',
        resourceVisible: body.resourceVisible === true,
        resourceInteractable: body.resourceInteractable === true,
        blockPolicyAllows: body.blockPolicyAllows === true,
        mutePolicyAllows: body.mutePolicyAllows === true,
        antiAbuseAdmission: isAntiAbuseAdmission(body.antiAbuseAdmission) ? body.antiAbuseAdmission : 'BLOCK',
      }

      try {
        const result = request.method === 'POST'
          ? await likeResource(env.DB, trusted)
          : await unlikeResource(env.DB, trusted)
        return json({ data: result, correlationId: trusted.correlationId }, request.method === 'POST' && result.created ? 201 : 200)
      } catch (error) {
        const mapped = mapLikeError(error)
        return json({ error: { code: mapped.code, message: 'Like operation denied or unavailable', details: {} }, correlationId: trusted.correlationId }, mapped.status)
      }
    }

    if (url.pathname !== '/internal/social/follows') return new Response(null, { status: 404 })
    if (request.method !== 'POST' && request.method !== 'DELETE') return json({ error: { code: 'METHOD_NOT_ALLOWED' } }, 405)
    const body = await readBody(request)
    if (!body) return json({ error: { code: 'VALIDATION_FAILED' } }, 400)
    const trusted: TrustedFollowAdmission = {
      caller: request.headers.get('X-LuckRead-Caller') ?? '',
      transportVersion: request.headers.get('X-LuckRead-Transport-Version') ?? '',
      actorUserId: request.headers.get('X-LuckRead-Principal-User-Id') ?? '',
      correlationId: request.headers.get('X-LuckRead-Correlation-Id') ?? '',
      idempotencyKey: request.headers.get('Idempotency-Key') ?? '',
      targetUserId: typeof body.targetUserId === 'string' ? body.targetUserId : '',
      actorAccountState: typeof body.actorAccountState === 'string' ? body.actorAccountState : '',
      targetFollowability: body.targetFollowability === true,
      blockPolicyAllows: body.blockPolicyAllows === true,
      privacyScopeAllows: body.privacyScopeAllows === true,
      antiAbuseAdmission: isAntiAbuseAdmission(body.antiAbuseAdmission) ? body.antiAbuseAdmission : 'BLOCK',
    }
    try {
      const result = request.method === 'POST' ? await followUser(env.DB, trusted) : await unfollowUser(env.DB, trusted)
      return json({ data: result, correlationId: trusted.correlationId }, request.method === 'POST' && result.created ? 201 : 200)
    } catch (error) {
      const mapped = mapFollowError(error)
      return json({ error: { code: mapped.code, message: 'Follow operation denied or unavailable', details: {} }, correlationId: trusted.correlationId }, mapped.status)
    }
  },
}
