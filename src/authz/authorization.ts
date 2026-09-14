import type { Access, PayloadRequest } from 'payload'

export type AuthorizationContext = {
  actorId: string | null
  subjectId: string | null
  organizationScope: string | null
  permissionContext: string[]
  requestId: string | null
  traceId: string | null
  correlationId: string | null
}

export function authorizationContext(req: PayloadRequest, subjectId?: string | null): AuthorizationContext {
  const actor = req.user as { id?: string | number } | null | undefined
  const headers = req.headers

  return {
    actorId: actor?.id == null ? null : String(actor.id),
    subjectId: subjectId ?? null,
    organizationScope: headers.get('x-organization-id'),
    permissionContext: [],
    requestId: headers.get('x-request-id'),
    traceId: headers.get('x-trace-id'),
    correlationId: headers.get('x-correlation-id'),
  }
}

export const authenticated: Access = ({ req }) => Boolean(req.user)

export const ownUserOnly: Access = ({ req, id }) => {
  if (!req.user || id == null) return false
  return String(req.user.id) === String(id)
}
