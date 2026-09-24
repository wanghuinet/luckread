import { buildAccountStateChangedAuditEvent, type AccountStateChangedAuditInput } from './audit-event'
import { persistAuditEvent } from './audit-event-persistence'

interface Env {
  D1_03: D1Database
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
    },
  })

const actorTypes = new Set(['user', 'service', 'admin', 'system', 'job'])
const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const requestIdPattern = /^req_[A-Za-z0-9_-]{1,123}$/
const traceIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

function parseAccountStateChangedInput(value: unknown): AccountStateChangedAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  const input = value as Record<string, unknown>
  const actor = input.actor

  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  const actorRecord = actor as Record<string, unknown>
  if (
    typeof actorRecord.actorId !== 'string' ||
    !actorRecord.actorId.trim() ||
    typeof actorRecord.actorType !== 'string' ||
    !actorTypes.has(actorRecord.actorType)
  ) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  if (
    actorRecord.layer !== undefined &&
    (typeof actorRecord.layer !== 'string' || !/^L[0-8]$/.test(actorRecord.layer))
  ) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  if (
    actorRecord.sessionId !== undefined &&
    (typeof actorRecord.sessionId !== 'string' || !actorRecord.sessionId.trim())
  ) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  if (
    actorRecord.impersonatingActorId !== undefined &&
    (typeof actorRecord.impersonatingActorId !== 'string' || !actorRecord.impersonatingActorId.trim())
  ) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  if (
    typeof input.eventId !== 'string' ||
    !resourceIdPattern.test(input.eventId) ||
    typeof input.userId !== 'string' ||
    !resourceIdPattern.test(input.userId) ||
    typeof input.beforeState !== 'string' ||
    typeof input.afterState !== 'string' ||
    typeof input.occurredAt !== 'string' ||
    !Number.isInteger(input.beforeVersion) ||
    !Number.isInteger(input.afterVersion)
  ) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  if (
    input.requestId !== undefined &&
    (typeof input.requestId !== 'string' || !requestIdPattern.test(input.requestId)) ||
    input.traceId !== undefined &&
    (typeof input.traceId !== 'string' || !traceIdPattern.test(input.traceId)) ||
    input.reason !== undefined &&
    (typeof input.reason !== 'string' || input.reason.length > 2048) ||
    input.ip !== undefined && typeof input.ip !== 'string' ||
    input.userAgent !== undefined &&
    (typeof input.userAgent !== 'string' || input.userAgent.length > 1024) ||
    Number.isNaN(Date.parse(input.occurredAt as string))
  ) {
    throw new Error('INVALID_AUDIT_EVENT')
  }

  return {
    eventId: input.eventId,
    requestId: input.requestId as string | undefined,
    traceId: input.traceId as string | undefined,
    actor: {
      actorId: actorRecord.actorId,
      actorType: actorRecord.actorType as AccountStateChangedAuditInput['actor']['actorType'],
      ...(actorRecord.layer ? { layer: actorRecord.layer as AccountStateChangedAuditInput['actor']['layer'] } : {}),
      ...(actorRecord.sessionId ? { sessionId: actorRecord.sessionId } : {}),
      ...(actorRecord.impersonatingActorId
        ? { impersonatingActorId: actorRecord.impersonatingActorId }
        : {}),
    },
    userId: input.userId,
    beforeState: input.beforeState,
    beforeVersion: input.beforeVersion,
    afterState: input.afterState,
    afterVersion: input.afterVersion,
    occurredAt: input.occurredAt,
    reason: input.reason as string | undefined,
    ip: input.ip as string | undefined,
    userAgent: input.userAgent as string | undefined,
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        service: 'W06',
        status: 'ok',
        auditPersistence: 'enabled',
        d1Binding: Boolean(env.D1_03),
      })
    }

    if (
      request.method === 'POST' &&
      url.pathname === '/internal/audit-events/account-state-changed'
    ) {
      let input: AccountStateChangedAuditInput

      try {
        input = parseAccountStateChangedInput(await request.json())
      } catch {
        return json({ error: 'INVALID_AUDIT_EVENT' }, 400)
      }

      try {
        const event = buildAccountStateChangedAuditEvent(input)
        await persistAuditEvent(env.D1_03, event)
        return json(
          {
            eventId: event.eventId,
            action: event.action,
            targetType: event.targetType,
            targetId: event.targetId,
          },
          201,
        )
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('INVALID_AUDIT_EVENT:')) {
          return json({ error: 'INVALID_AUDIT_EVENT' }, 400)
        }
        if (error instanceof Error && error.message === 'AUDIT_EVENT_PERSISTENCE_FAILED') {
          return json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, 503)
        }
        return json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, 503)
      }
    }

    return new Response(null, { status: 404 })
  },
}
