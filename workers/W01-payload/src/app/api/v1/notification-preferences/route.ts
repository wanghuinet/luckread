import {
  callW05Social,
  W05SocialClientError,
  resolveCookieSocialPrincipal,
} from '../../../../social/w05-social-client.js'
import { callW08Creator } from '../../../../auth/w08-creator-client.js'
import { callW06NotificationPreferencesMutationAudit } from '../../../../moderation/w06-moderation-client.js'
import {
  TrafficLimitError,
  enforcePublicReadRateLimit,
  enforceW01WriteAccountRateLimit,
  enforceW01WriteEndpointRateLimit,
  enforceW01WriteRateLimit,
  rateLimitResponse,
} from '../../../../auth/traffic-limit.js'

type NotificationPreferencesPatch = Partial<{
  follow: boolean
  like: boolean
  comment: boolean
  mention: boolean
}>
const preferenceKeys = ['follow', 'like', 'comment', 'mention'] as const
const errorResponse = (status: number, code: string, message: string) => Response.json(
  { error: { code, message, details: {} }, requestId: `req_${crypto.randomUUID()}` },
  { status, headers: { 'cache-control': 'no-store' } },
)

async function readPreferencesPatch(request: Request): Promise<NotificationPreferencesPatch | null> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > 2048)) return null
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > 2048) {
        await reader.cancel()
        return null
      }
      chunks.push(part.value)
    }
  } catch { return null }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder().decode(bytes)) as unknown } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const keys = Object.keys(raw)
  if (keys.length === 0 || keys.some(key => !preferenceKeys.includes(key as typeof preferenceKeys[number]))) return null
  const patch: NotificationPreferencesPatch = {}
  for (const key of preferenceKeys) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') return null
    patch[key] = raw[key]
  }
  return patch
}

async function authorizePreferences(
  request: Request,
  principal: { userId: string; layer: string | null },
  permission: 'notification.read.self' | 'notification.update.self',
): Promise<Response | null> {
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')
  headers.set('content-type', 'application/json; charset=utf-8')
  const permissionRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: permission,
      resourceType: 'Notification',
      resourceAttributes: { ownerId: principal.userId },
    }),
  })
  let response: Response
  try { response = await callW08Creator(permissionRequest, '/internal/authz/check-permission', 'POST') }
  catch { return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization unavailable') }
  if (!response.ok) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization unavailable')
  const value: unknown = await response.json().catch((): null => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization response could not be verified')
  }
  const result = value as Record<string, unknown>
  if (result.decision === 'DENY') return errorResponse(403, 'PERMISSION_DENIED', 'Notification preference permission required')
  if (
    result.decision !== 'ALLOW' ||
    result.action !== permission ||
    result.resourceType !== 'Notification' ||
    result.policyVersion !== 'casl-l0-l8-v1' ||
    result.layer !== principal.layer
  ) return errorResponse(503, 'AUTHORIZATION_UNAVAILABLE', 'Notification authorization response could not be verified')
  return null
}

async function auditPreferenceMutation(
  request: Request,
  principal: { userId: string; layer: string | null; verified?: boolean },
  preferences: NotificationPreferencesPatch,
): Promise<Response | null> {
  const eventId = `evt_notification_preferences_${crypto.randomUUID()}`
  let response: Response
  try {
    response = await callW06NotificationPreferencesMutationAudit({ request, principal, body: { eventId, preferences } })
  } catch {
    return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Notification preference change could not be durably audited')
  }
  const value: unknown = await response.clone().json().catch((): null => null)
  if (
    (response.status !== 200 && response.status !== 201) ||
    !value || typeof value !== 'object' || Array.isArray(value) ||
    (value as Record<string, unknown>).eventId !== eventId ||
    (value as Record<string, unknown>).action !== 'notification.preferences.update_requested' ||
    (value as Record<string, unknown>).targetType !== 'Notification' ||
    (value as Record<string, unknown>).targetId !== principal.userId
  ) return errorResponse(503, 'AUDIT_UNAVAILABLE', 'Notification preference change was not durably confirmed')
  return null
}

export async function GET(request: Request): Promise<Response> {
  try {
    await enforcePublicReadRateLimit(request)
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    const denied = await authorizePreferences(request, principal, 'notification.read.self')
    if (denied) return denied
    return await callW05Social({ request, pathname: '/internal/social/notification-preferences', method: 'GET', principal })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Notification preferences unavailable')
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    await enforceW01WriteRateLimit(request)
    const principal = await resolveCookieSocialPrincipal(request)
    if (principal instanceof Response) return principal
    await enforceW01WriteAccountRateLimit(principal.userId)
    await enforceW01WriteEndpointRateLimit('patchNotificationPreferences')
    const preferences = await readPreferencesPatch(request)
    if (!preferences) return errorResponse(422, 'VALIDATION_FAILED', 'At least one valid notification preference is required')
    const denied = await authorizePreferences(request, principal, 'notification.update.self')
    if (denied) return denied
    const auditDenied = await auditPreferenceMutation(request, principal, preferences)
    if (auditDenied) return auditDenied
    return await callW05Social({
      request,
      pathname: '/internal/social/notification-preferences',
      method: 'PATCH',
      principal,
      body: preferences,
    })
  } catch (error) {
    if (error instanceof TrafficLimitError) return rateLimitResponse(request)
    if (error instanceof W05SocialClientError) return errorResponse(error.status, error.code, error.message)
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Notification preferences unavailable')
  }
}
