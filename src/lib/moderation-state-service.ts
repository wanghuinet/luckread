import { randomUUID } from 'node:crypto'
import { APIError, type PayloadRequest } from 'payload'

const REPORT_TRANSITIONS = {
  OPEN: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['RESOLVED', 'DISMISSED'],
} as const

const APPEAL_TRANSITIONS = {
  OPEN: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['UPHELD', 'OVERTURNED'],
  UPHELD: ['CLOSED'],
  OVERTURNED: ['CLOSED'],
} as const

function hasModerationPermission(user: unknown, permission: string): boolean {
  const value = user as { role?: string; permissions?: string[] } | null
  if (!value) return false
  if (value.permissions?.includes(permission)) return true
  return ['moderator', 'admin', 'super_admin'].includes(value.role ?? '')
}

export async function transitionReport(req: PayloadRequest, to: string): Promise<Response> {
  if (!req.user) throw new APIError('Authentication required', 401)
  if (!hasModerationPermission(req.user, 'report.review')) throw new APIError('Report review permission denied', 403)
  const id = String(req.routeParams.id)
  const current = await req.payload.findByID({ collection: 'reports', id, depth: 0, overrideAccess: true, req })
  const allowed = (REPORT_TRANSITIONS[current.status as keyof typeof REPORT_TRANSITIONS] ?? []) as readonly string[]
  if (!allowed.includes(to)) throw new APIError(`Invalid report transition: ${current.status} -> ${to}`, 409)
  const updated = await req.payload.update({
    collection: 'reports', id,
    data: { status: to, resolution: (await req.json().catch(() => ({})) as { resolution?: string }).resolution },
    overrideAccess: true, req,
  })
  await req.payload.create({ collection: 'moderation-events', data: {
    eventId: randomUUID(), resourceType: 'report', resourceId: id, action: `report.${to.toLowerCase()}`,
    fromState: current.status, toState: to, actorId: String(req.user.id), metadata: {},
  }, overrideAccess: true, req })
  return Response.json({ data: updated, transition: { from: current.status, to } })
}

export async function transitionAppeal(req: PayloadRequest, to: string): Promise<Response> {
  if (!req.user) throw new APIError('Authentication required', 401)
  if (!hasModerationPermission(req.user, 'appeal.review')) throw new APIError('Appeal review permission denied', 403)
  const id = String(req.routeParams.id)
  const current = await req.payload.findByID({ collection: 'appeals', id, depth: 0, overrideAccess: true, req })
  const allowed = (APPEAL_TRANSITIONS[current.status as keyof typeof APPEAL_TRANSITIONS] ?? []) as readonly string[]
  if (!allowed.includes(to)) throw new APIError(`Invalid appeal transition: ${current.status} -> ${to}`, 409)
  const body = await req.json().catch(() => ({})) as { decision?: string }
  const updated = await req.payload.update({
    collection: 'appeals', id,
    data: { status: to, decision: body.decision, decidedBy: String(req.user.id) },
    overrideAccess: true, req,
  })
  await req.payload.create({ collection: 'moderation-events', data: {
    eventId: randomUUID(), resourceType: 'appeal', resourceId: id, action: `appeal.${to.toLowerCase()}`,
    fromState: current.status, toState: to, actorId: String(req.user.id), metadata: {},
  }, overrideAccess: true, req })
  return Response.json({ data: updated, transition: { from: current.status, to } })
}
