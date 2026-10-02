import { buildAccountStateChangedAuditEvent, type AccountStateChangedAuditInput } from './audit-event'
import { persistAuditEvent } from './audit-event-persistence'
import { consumeAccountStateChanged } from './auth-013-queue-consumer'
import {
  ModerationRuntimeError,
  decideModerationCase,
  deliverModerationOutbox,
  drainModerationOutbox,
  getModerationCase,
  listModerationQueue,
} from './moderation-runtime'
import { createReport, ReportRuntimeError } from './report-runtime'

interface Env {
  D1_03: D1Database
  W03_CONTENT_MODERATION: Fetcher
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })

const actorTypes = new Set(['user', 'service', 'admin', 'system', 'job'])
const resourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const requestIdPattern = /^req_[A-Za-z0-9_-]{1,123}$/
const traceIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

function parseAccountStateChangedInput(value: unknown): AccountStateChangedAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_AUDIT_EVENT')

  const input = value as Record<string, unknown>
  const actor = input.actor
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) throw new Error('INVALID_AUDIT_EVENT')

  const actorRecord = actor as Record<string, unknown>
  if (
    typeof actorRecord.actorId !== 'string' ||
    !resourceIdPattern.test(actorRecord.actorId) ||
    typeof actorRecord.actorType !== 'string' ||
    !actorTypes.has(actorRecord.actorType)
  ) throw new Error('INVALID_AUDIT_EVENT')

  if (actorRecord.layer !== undefined && (typeof actorRecord.layer !== 'string' || !/^L[0-8]$/.test(actorRecord.layer))) {
    throw new Error('INVALID_AUDIT_EVENT')
  }
  if (actorRecord.sessionId !== undefined && (typeof actorRecord.sessionId !== 'string' || !resourceIdPattern.test(actorRecord.sessionId))) {
    throw new Error('INVALID_AUDIT_EVENT')
  }
  if (actorRecord.impersonatingActorId !== undefined && (typeof actorRecord.impersonatingActorId !== 'string' || !resourceIdPattern.test(actorRecord.impersonatingActorId))) {
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
  ) throw new Error('INVALID_AUDIT_EVENT')

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
  ) throw new Error('INVALID_AUDIT_EVENT')

  return {
    eventId: input.eventId,
    requestId: input.requestId as string | undefined,
    traceId: input.traceId as string | undefined,
    actor: {
      actorId: actorRecord.actorId,
      actorType: actorRecord.actorType as AccountStateChangedAuditInput['actor']['actorType'],
      ...(actorRecord.layer ? { layer: actorRecord.layer as AccountStateChangedAuditInput['actor']['layer'] } : {}),
      ...(actorRecord.sessionId ? { sessionId: actorRecord.sessionId } : {}),
      ...(actorRecord.impersonatingActorId ? { impersonatingActorId: actorRecord.impersonatingActorId } : {}),
    },
    userId: input.userId,
    beforeState: input.beforeState,
    beforeVersion: input.beforeVersion as number,
    afterState: input.afterState,
    afterVersion: input.afterVersion as number,
    occurredAt: input.occurredAt,
    reason: input.reason as string | undefined,
    ip: input.ip as string | undefined,
    userAgent: input.userAgent as string | undefined,
  }
}

const MODERATION_OPERATION_PERMISSIONS = {
  listModerationQueue: 'moderation.queue.read',
  getModerationCase: 'moderation.case.read',
  decideModerationCase: 'moderation.decide',
} as const

type ModerationOperationId = keyof typeof MODERATION_OPERATION_PERMISSIONS

const requireModerationPermission = (operationId: ModerationOperationId, layer: string): void => {
  if (!/^L[0-8]$/.test(layer) || Number(layer.slice(1)) < 6) {
    throw new ModerationRuntimeError('PERMISSION_DENIED', 403)
  }
  // Canonical permissions contract currently gives all three moderation permissions
  // the same L6 platform minimum. The client never supplies the permission.
  const permission = MODERATION_OPERATION_PERMISSIONS[operationId]
  if (!permission) throw new ModerationRuntimeError('PERMISSION_DENIED', 403)
}

const requireW01Transport = (request: Request): { userId: string; layer: string; correlationId: string; requestId: string } => {
  if (
    request.headers.get('X-LuckRead-Caller') !== 'W01' ||
    request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
  ) throw new ModerationRuntimeError('PERMISSION_DENIED', 403)

  const userId = request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ?? ''
  const layer = request.headers.get('X-LuckRead-Principal-Layer')?.trim() ?? ''
  const correlationId = request.headers.get('X-LuckRead-Correlation-Id')?.trim() ?? ''
  const requestId = request.headers.get('X-LuckRead-Request-Id')?.trim() ?? ''
  if (!userId || !layer || !correlationId || !requestId) throw new ModerationRuntimeError('UNAUTHENTICATED', 401)
  return { userId, layer, correlationId, requestId }
}

const parseDecision = (value: unknown): {
  decision: 'APPROVED' | 'REJECTED'
  expectedVersion: number
  policyVersion: string
  reasonCode: string
  severity: string
  scope: string
  effectiveAt: string
  expiresAt: string | null
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  const body = value as Record<string, unknown>
  if (
    (body.decision !== 'APPROVED' && body.decision !== 'REJECTED') ||
    !Number.isInteger(body.expectedVersion) ||
    typeof body.policyVersion !== 'string' ||
    typeof body.reasonCode !== 'string' ||
    typeof body.severity !== 'string' ||
    typeof body.scope !== 'string' ||
    typeof body.effectiveAt !== 'string' ||
    (body.expiresAt !== null && body.expiresAt !== undefined && typeof body.expiresAt !== 'string')
  ) throw new ModerationRuntimeError('VALIDATION_FAILED', 400)
  const expectedVersion = body.expectedVersion as number
  return {
    decision: body.decision as 'APPROVED' | 'REJECTED',
    expectedVersion,
    policyVersion: body.policyVersion,
    reasonCode: body.reasonCode,
    severity: body.severity,
    scope: body.scope,
    effectiveAt: body.effectiveAt,
    expiresAt: body.expiresAt === undefined ? null : body.expiresAt as string | null,
  }
}

const errorResponse = (error: unknown, requestId?: string): Response => {
  if (error instanceof ReportRuntimeError) {
    const message =
      error.code === 'UNAUTHENTICATED' ? 'Authentication required' :
      error.code === 'PERMISSION_DENIED' ? 'Permission denied' :
      error.code === 'NOT_FOUND' ? 'Reported resource not found' :
      error.code === 'PRECONDITION_REQUIRED' ? 'Idempotency-Key is required' :
      error.code === 'CONFLICT' ? 'Conflicting report request' :
      error.code === 'RATE_LIMITED' ? 'Too many reports' :
      error.code === 'REPORT_WRITE_FAILED' ? 'Report could not be created' :
      'Invalid report request'
    return json({ error: { code: error.code, message, details: {} }, requestId: requestId ?? crypto.randomUUID() }, error.status)
  }
  if (error instanceof ModerationRuntimeError) {
    const code = error.code
    const message =
      code === 'UNAUTHENTICATED' ? 'Authentication required' :
      code === 'PERMISSION_DENIED' ? 'Permission denied' :
      code === 'NOT_FOUND' ? 'Moderation case not found' :
      code === 'PRECONDITION_REQUIRED' ? 'If-Match and Idempotency-Key are required' :
      code === 'PRECONDITION_FAILED' ? 'Moderation case has changed' :
      code === 'INVALID_STATE' ? 'Invalid moderation case state' :
      code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ? 'Idempotency-Key cannot be reused with different input' :
      code === 'REPORT_WRITE_FAILED' ? 'Report could not be created' :
      code === 'PRECONDITION_REQUIRED' ? 'Idempotency-Key is required' :
      code === 'CONFLICT' ? 'Conflicting report request' :
      code === 'SERVICE_UNAVAILABLE' ? 'Moderation service unavailable' :
      'Invalid moderation request'
    return json({ error: { code, message, details: {} }, requestId: requestId ?? crypto.randomUUID() }, error.status)
  }
  return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Moderation service unavailable', details: {} }, requestId: requestId ?? crypto.randomUUID() }, 503)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ service: 'W06', status: 'ok', auditPersistence: 'enabled', d1Binding: Boolean(env.D1_03), moderationRuntime: 'enabled' })
    }

    if (request.method === 'POST' && url.pathname === '/reports') {
      try {
        const principal = requireW01Transport(request)
        const permission = principal.layer
        if (!/^L[0-8]$/.test(permission)) throw new ReportRuntimeError('PERMISSION_DENIED', 403)
        const idempotencyKey = request.headers.get('Idempotency-Key')?.trim() ?? ''
        if (!idempotencyKey) throw new ReportRuntimeError('PRECONDITION_REQUIRED', 428)
        let body: unknown
        try { body = await request.json() } catch { throw new ReportRuntimeError('VALIDATION_FAILED', 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ReportRuntimeError('VALIDATION_FAILED', 400)
        const input = body as Record<string, unknown>
        const targetType = input.targetType
        const targetId = input.targetId
        const reasonCode = input.reasonCode
        const description = input.description
        const evidenceRefs = input.evidenceRefs
        if (
          (targetType !== 'content' && targetType !== 'comment' && targetType !== 'creator' && targetType !== 'media' && targetType !== 'profile') ||
          typeof targetId !== 'string' ||
          typeof reasonCode !== 'string' ||
          (description !== undefined && typeof description !== 'string') ||
          (evidenceRefs !== undefined && (!Array.isArray(evidenceRefs) || evidenceRefs.some((value) => typeof value !== 'string')))
        ) throw new ReportRuntimeError('VALIDATION_FAILED', 400)
        const result = await createReport(env.D1_03, {
          actorUserId: principal.userId,
          targetType,
          targetId,
          reasonCode,
          ...(description !== undefined ? { description } : {}),
          ...(evidenceRefs !== undefined ? { evidenceRefs: evidenceRefs as string[] } : {}),
          idempotencyKey,
          requestId: principal.requestId,
          correlationId: principal.correlationId,
        })
        return json({ data: result, requestId: principal.requestId }, 201)
      } catch (error) {
        return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim())
      }
    }

    if (request.method === 'GET' && url.pathname === '/admin/moderation/queue') {
      try {
        const principal = requireW01Transport(request)
        requireModerationPermission('listModerationQueue', principal.layer)
        return json({
          ...(await listModerationQueue(
            env.D1_03,
            principal.userId,
            url.searchParams.get('cursor'),
            url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : null,
          )),
          requestId: principal.requestId,
        })
      } catch (error) {
        return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim())
      }
    }

    const caseMatch = /^\/admin\/moderation\/cases\/([^/]+)$/.exec(url.pathname)
    if (request.method === 'GET' && caseMatch) {
      try {
        const principal = requireW01Transport(request)
        requireModerationPermission('getModerationCase', principal.layer)
        return json({
          ...(await getModerationCase(env.D1_03, principal.userId, decodeURIComponent(caseMatch[1]))),
          requestId: principal.requestId,
        })
      } catch (error) {
        return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim())
      }
    }

    const decisionMatch = /^\/admin\/moderation\/cases\/([^/]+)\/decision$/.exec(url.pathname)
    if (request.method === 'POST' && decisionMatch) {
      try {
        const principal = requireW01Transport(request)
        requireModerationPermission('decideModerationCase', principal.layer)
        const body = parseDecision(await request.json())
        const result = await decideModerationCase(env.D1_03, env.W03_CONTENT_MODERATION, {
          reviewerId: principal.userId,
          reviewerLayer: principal.layer,
          caseId: decodeURIComponent(decisionMatch[1]),
          ifMatch: request.headers.get('If-Match'),
          idempotencyKey: request.headers.get('Idempotency-Key'),
          correlationId: principal.correlationId,
          requestId: principal.requestId,
          ...body,
        })
        return json(result, 200)
      } catch (error) {
        return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim())
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/account-state-changed') {
      let input: AccountStateChangedAuditInput
      try { input = parseAccountStateChangedInput(await request.json()) }
      catch { return json({ error: 'INVALID_AUDIT_EVENT' }, 400) }
      try {
        const event = buildAccountStateChangedAuditEvent(input)
        await persistAuditEvent(env.D1_03, event)
        return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId }, 201)
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('INVALID_AUDIT_EVENT:')) return json({ error: 'INVALID_AUDIT_EVENT' }, 400)
        return json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, 503)
      }
    }

    return new Response(null, { status: 404 })
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    try {
      await drainModerationOutbox(env.D1_03, env.W03_CONTENT_MODERATION, 10)
    } catch {
      // The next scheduled run retries durable outbox records.
    }
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await consumeAccountStateChanged(env.D1_03, message.body)
        message.ack()
      } catch (error) {
        if (error instanceof Error && error.message === 'INVALID_AUTH_013_EVENT') {
          message.retry({ delaySeconds: 0 })
          continue
        }
        message.retry()
      }
    }
  },
}
