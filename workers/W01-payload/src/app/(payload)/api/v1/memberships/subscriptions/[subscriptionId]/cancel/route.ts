import { resolveContentPrincipal, type ContentPrincipal } from '@/content/w03-content-client'
import {
  readMembershipSubscription,
  transitionMembershipSubscription,
  W07MembershipClientError,
} from '@/membership/w07-membership-client'

const MIN_MEMBERSHIP_MUTATION_LAYER = 2
const subscriptionStatuses = new Set(['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'])

const error = (status: number, code: string, message: string) =>
  Response.json(
    { error: { code, message, details: {} }, requestId: crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  )

const parseIfMatchVersion = (value: string): number | null => {
  const match = value.trim().match(/^(?:W\/)?"([1-9]\d{0,17})"$/)
  if (!match) return null
  const version = Number(match[1])
  return Number.isSafeInteger(version) && version > 0 ? version : null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ subscriptionId: string }> },
): Promise<Response> {
  const principal = await resolveContentPrincipal(request)
  if (principal instanceof Response) return principal

  const layer = Number((principal as ContentPrincipal).layer?.slice(1) ?? '-1')
  if (!Number.isInteger(layer) || layer < MIN_MEMBERSHIP_MUTATION_LAYER) {
    return error(403, 'PERMISSION_DENIED', 'Permission denied')
  }

  const { subscriptionId } = await context.params
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(subscriptionId)) {
    return error(400, 'VALIDATION_FAILED', 'Invalid subscription identifier')
  }

  const ifMatch = request.headers.get('If-Match')
  if (!ifMatch) return error(428, 'PRECONDITION_REQUIRED', 'If-Match is required')
  const expectedVersion = parseIfMatchVersion(ifMatch)
  if (expectedVersion === null) return error(412, 'PRECONDITION_FAILED', 'Invalid If-Match value')

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim()
  if (!idempotencyKey || idempotencyKey.length > 256) {
    return error(400, 'VALIDATION_FAILED', 'Invalid Idempotency-Key')
  }

  try {
    const snapshotResponse = await readMembershipSubscription({
      request,
      actorUserId: principal.userId,
      subscriptionId,
    })

    if (!snapshotResponse.ok) {
      const status = snapshotResponse.status === 404 ? 404 : snapshotResponse.status === 403 ? 403 : 503
      return error(
        status,
        status === 404 ? 'RESOURCE_NOT_FOUND' : status === 403 ? 'PERMISSION_DENIED' : 'SERVICE_UNAVAILABLE',
        status === 404 ? 'Subscription not found' : status === 403 ? 'Permission denied' : 'Membership service unavailable',
      )
    }

    const currentETag = snapshotResponse.headers.get('etag')
    if (!currentETag || parseIfMatchVersion(currentETag) !== expectedVersion) {
      return error(412, 'PRECONDITION_FAILED', 'Subscription version precondition failed')
    }

    const snapshot = await snapshotResponse.json() as { status?: unknown; version?: unknown }
    if (
      typeof snapshot.status !== 'string' ||
      !subscriptionStatuses.has(snapshot.status) ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version !== expectedVersion
    ) {
      return error(503, 'SERVICE_UNAVAILABLE', 'Invalid authoritative membership snapshot')
    }
    if (snapshot.status !== 'ACTIVE') {
      return error(409, 'INVALID_STATE', 'Subscription is not active')
    }

    const transition = await transitionMembershipSubscription({
      request,
      actorUserId: principal.userId,
      subscriptionId,
      from: 'ACTIVE',
      expectedVersion,
      idempotencyKey,
    })

    if (!transition.ok) {
      const status = [403, 404, 409, 412].includes(transition.status) ? transition.status : 503
      const code =
        status === 403 ? 'PERMISSION_DENIED' :
        status === 404 ? 'RESOURCE_NOT_FOUND' :
        status === 409 ? 'INVALID_STATE' :
        status === 412 ? 'PRECONDITION_FAILED' :
        'SERVICE_UNAVAILABLE'
      return error(status, code, 'Membership cancellation was not applied')
    }

    return new Response(await transition.arrayBuffer(), {
      status: 200,
      headers: {
        'content-type': transition.headers.get('content-type') ?? 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ETag: `W/"${expectedVersion + 1}"`,
      },
    })
  } catch (e) {
    if (e instanceof W07MembershipClientError) {
      const status = e.status === 404 ? 404 : e.status === 403 ? 403 : 503
      return error(
        status,
        status === 404 ? 'RESOURCE_NOT_FOUND' : status === 403 ? 'PERMISSION_DENIED' : 'SERVICE_UNAVAILABLE',
        'Membership service unavailable',
      )
    }
    return error(503, 'SERVICE_UNAVAILABLE', 'Membership service unavailable')
  }
}
