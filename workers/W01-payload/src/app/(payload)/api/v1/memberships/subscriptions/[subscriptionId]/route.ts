import { resolveContentPrincipal, type ContentPrincipal } from '@/content/w03-content-client'
import {
  readMembershipSubscription,
  W07MembershipClientError,
} from '@/membership/w07-membership-client'

const MIN_MEMBERSHIP_READ_LAYER = 2

const error = (status: number, code: string, message: string) =>
  Response.json(
    {
      error: { code, message, details: {} },
      requestId: crypto.randomUUID(),
    },
    {
      status,
      headers: { 'cache-control': 'no-store' },
    },
  )

export async function GET(
  request: Request,
  context: { params: Promise<{ subscriptionId: string }> },
): Promise<Response> {
  const principal = await resolveContentPrincipal(request)
  if (principal instanceof Response) return principal

  const layer = Number((principal as ContentPrincipal).layer?.slice(1) ?? '-1')
  if (!Number.isInteger(layer) || layer < MIN_MEMBERSHIP_READ_LAYER) {
    return error(403, 'PERMISSION_DENIED', 'Permission denied')
  }

  const { subscriptionId } = await context.params
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(subscriptionId)
  ) {
    return error(400, 'VALIDATION_FAILED', 'Invalid subscription identifier')
  }

  try {
    return await readMembershipSubscription({
      request,
      actorUserId: principal.userId,
      subscriptionId,
    })
  } catch (e) {
    if (e instanceof W07MembershipClientError) {
      const status = e.status === 404 ? 404 : e.status === 403 ? 403 : 503
      return error(
        status,
        status === 404 ? 'RESOURCE_NOT_FOUND' : status === 403 ? 'PERMISSION_DENIED' : 'SERVICE_UNAVAILABLE',
        status === 404 ? 'Subscription not found' : status === 403 ? 'Permission denied' : 'Membership service unavailable',
      )
    }
    return error(503, 'SERVICE_UNAVAILABLE', 'Membership service unavailable')
  }
}
