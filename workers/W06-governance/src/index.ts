import { buildAccountStateChangedAuditEvent, type AccountStateChangedAuditInput, type AuditEvent } from './audit-event'
import { persistAuditEvent } from './audit-event-persistence'
import { consumeAccountStateChanged } from './auth-013-queue-consumer'
import { consumeMfaAuditEvent } from './mfa-audit-queue-consumer'
import { parseEventEnvelopeMetadata } from '../../W10-async/src/event-envelope.js'
import { processQueueBatch } from '../../W10-async/src/queue-batch.js'
import { QueueTaskFailure } from '../../W10-async/src/retry-policy.js'
import {
  ModerationRuntimeError,
  decideModerationCase,
  deliverModerationOutbox,
  drainModerationOutbox,
  getModerationCase,
  listModerationQueue,
} from './moderation-runtime'
import { createReport, ReportRuntimeError } from './report-runtime'

interface RateLimitBinding { limit(input: { key: string }): Promise<{ success: boolean }> }
interface Env {
  D1_03: D1Database
  W03_CONTENT_MODERATION: Fetcher
  GOVERNANCE_ORIGIN_GLOBAL_LIMITER?: RateLimitBinding
  GOVERNANCE_READ_LIMITER?: RateLimitBinding
  GOVERNANCE_WRITE_LIMITER?: RateLimitBinding
}

const getRateKey = (request: Request): string =>
  request.headers.get('X-LuckRead-Principal-User-Id')?.trim() ||
  request.headers.get('X-LuckRead-Client-IP')?.trim() ||
  'transport:W01'

const enforceRateLimit = async (request: Request, env: Env): Promise<void> => {
  const operation = request.method === 'GET' ? 'read' : 'write'
  if (env.GOVERNANCE_ORIGIN_GLOBAL_LIMITER) {
    const result = await env.GOVERNANCE_ORIGIN_GLOBAL_LIMITER.limit({ key: 'origin:' + operation })
    if (!result.success) throw new ModerationRuntimeError('RATE_LIMITED', 429)
  }
  const actorLimiter = operation === 'read' ? env.GOVERNANCE_READ_LIMITER : env.GOVERNANCE_WRITE_LIMITER
  if (actorLimiter) {
    const result = await actorLimiter.limit({ key: operation + ':' + getRateKey(request) })
    if (!result.success) throw new ModerationRuntimeError('RATE_LIMITED', 429)
  }
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  })

const canonicalRequestId = (value?: string): string =>
  value && /^req_[A-Za-z0-9_-]{1,123}$/.test(value)
    ? value
    : 'req_' + crypto.randomUUID().replaceAll('-', '')

const CANONICAL_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'INVALID_STATE',
  'PRECONDITION_FAILED',
  'PRECONDITION_REQUIRED',
  'CONFLICT',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REUSE_CONFLICT',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPLOAD_REJECTED',
  'RESOURCE_LOCKED',
  'INVALID_CURSOR',
  'CURSOR_EXPIRED',
  'DEPENDENCY_FAILED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
])

export const canonicalErrorCode = (code: string): string => {
  if (CANONICAL_ERROR_CODES.has(code)) return code
  if (code === 'REPORT_WRITE_FAILED' || code.endsWith('_WRITE_FAILED')) return 'INTERNAL_ERROR'
  if (code === 'RELATIONSHIP_BLOCKED' || code === 'SELF_FOLLOW_NOT_ALLOWED') return 'CONFLICT'
  if (code.startsWith('INVALID_')) return 'VALIDATION_FAILED'
  return code
}

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
  listModerationQueue: { permission: 'moderation.queue.read', resourceType: 'ModerationQueue' },
  getModerationCase: { permission: 'moderation.case.read', resourceType: 'ModerationCase' },
  decideModerationCase: { permission: 'moderation.decide', resourceType: 'ModerationCase' },
} as const

type ModerationOperationId = keyof typeof MODERATION_OPERATION_PERMISSIONS
const MODERATION_CASL_POLICY_VERSION = 'casl-l0-l8-v1'

const requireModerationPermission = (
  operationId: ModerationOperationId,
  principal: { userId: string; layer: string },
  request: Request,
): void => {
  const required = MODERATION_OPERATION_PERMISSIONS[operationId]
  if (
    !/^L[0-8]$/.test(principal.layer) ||
    Number(principal.layer.slice(1)) < 6 ||
    !required ||
    request.headers.get('X-LuckRead-Authz-Decision') !== 'ALLOW' ||
    request.headers.get('X-LuckRead-Authz-Permission') !== required.permission ||
    request.headers.get('X-LuckRead-Authz-Resource-Type') !== required.resourceType ||
    request.headers.get('X-LuckRead-Authz-Policy-Version') !== MODERATION_CASL_POLICY_VERSION ||
    request.headers.get('X-LuckRead-Authz-Subject-Id') !== principal.userId ||
    request.headers.get('X-LuckRead-Authz-Layer') !== principal.layer
  ) {
    throw new ModerationRuntimeError('PERMISSION_DENIED', 403)
  }
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
    const code = canonicalErrorCode(error.code)
    const message =
      error.code === 'UNAUTHENTICATED' ? 'Authentication required' :
      error.code === 'PERMISSION_DENIED' ? 'Permission denied' :
      error.code === 'NOT_FOUND' ? 'Reported resource not found' :
      error.code === 'PRECONDITION_REQUIRED' ? 'Idempotency-Key is required' :
      code === 'CONFLICT' ? 'Conflicting report request' :
      error.code === 'RATE_LIMITED' ? 'Too many reports' :
      error.code === 'REPORT_WRITE_FAILED' ? 'Report could not be created' :
      code === 'INTERNAL_ERROR' ? 'Report could not be created' :
      'Invalid report request'
    const status = code === 'VALIDATION_FAILED' && error.status === 400 ? 422 : code === 'INTERNAL_ERROR' && error.status < 500 ? 500 : error.status
    return json({ error: { code, message, details: {} }, requestId: canonicalRequestId(requestId) }, status)
  }
  if (error instanceof ModerationRuntimeError) {
    const code = canonicalErrorCode(error.code)
    const message =
      error.code === 'UNAUTHENTICATED' ? 'Authentication required' :
      error.code === 'PERMISSION_DENIED' ? 'Permission denied' :
      error.code === 'NOT_FOUND' ? 'Moderation case not found' :
      error.code === 'PRECONDITION_REQUIRED' ? 'If-Match and Idempotency-Key are required' :
      error.code === 'PRECONDITION_FAILED' ? 'Moderation case has changed' :
      error.code === 'INVALID_STATE' ? 'Invalid moderation case state' :
      error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ? 'Idempotency-Key cannot be reused with different input' :
      error.code === 'REPORT_WRITE_FAILED' ? 'Report could not be created' :
      code === 'CONFLICT' ? 'Conflicting moderation request' :
      code === 'INTERNAL_ERROR' ? 'Moderation service unavailable' :
      error.code === 'SERVICE_UNAVAILABLE' ? 'Moderation service unavailable' :
      'Invalid moderation request'
    const status = code === 'VALIDATION_FAILED' && error.status === 400 ? 422 : code === 'INTERNAL_ERROR' && error.status < 500 ? 500 : error.status
    return json({ error: { code, message, details: {} }, requestId: canonicalRequestId(requestId) }, status)
  }
  return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Moderation service unavailable', details: {} }, requestId: canonicalRequestId(requestId) }, 503)
}

type MembershipPlanAuditInput = {
  eventId: string
  planId: string
  creatorId: string
  planVersion: 1
  status: 'DRAFT'
  visibility: 'PRIVATE'
  occurredAt: string
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  trialDays: number
}




type MembershipPlanPublishRequestAuditInput = {
  eventId: string
  planId: string
  creatorId: string
  expectedVersion: number
  requestedStatus: 'ACTIVE'
  requestedVisibility: 'PUBLIC'
}

type MembershipPlanPublishAuditInput = {
  eventId: string
  planId: string
  creatorId: string
  planVersion: number
  status: 'ACTIVE'
  visibility: 'PUBLIC'
  version: number
  occurredAt: string
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  trialDays: number
}


type MembershipPlanUpdateRequestAuditInput = {
  eventId: string
  planId: string
  creatorId: string
  expectedVersion: number
  idempotencyKey: string
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  benefits: string[]
  trialDays?: number
}

type MembershipPlanUpdateAuditInput = {
  eventId: string
  planId: string
  creatorId: string
  expectedVersion: number
  planVersion: number
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED'
  visibility: 'PRIVATE' | 'PUBLIC'
  version: number
  occurredAt: string
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  benefits: string[]
  trialDays: number
}

type MembershipPlanLifecycleRequestAuditInput = {
  eventId: string; planId: string; creatorId: string; expectedVersion: number
  action: 'pause' | 'resume' | 'retire'; requestedStatus: 'PAUSED' | 'ACTIVE' | 'RETIRED'; requestedVisibility: 'PRIVATE' | 'PUBLIC'
}
type MembershipPlanLifecycleAuditInput = {
  eventId: string; planId: string; creatorId: string; expectedVersion: number
  planVersion: number; action: 'pause' | 'resume' | 'retire'; status: 'PAUSED' | 'ACTIVE' | 'RETIRED'
  visibility: 'PRIVATE' | 'PUBLIC'; version: number; occurredAt: string
}

type SubscriptionPlanChangeRequestAuditInput = {
  eventId: string; subscriptionId: string; targetPlanId: string
  expectedVersion: number; idempotencyKey: string
}

type SubscriptionPlanChangeAuditInput = {
  eventId: string; changeId: string; subscriptionId: string
  sourcePlanId: string; sourcePlanVersion: number; targetPlanId: string; targetPlanVersion: number
  changeType: 'DOWNGRADE' | 'BILLING_INTERVAL_CHANGE' | 'SAME_PRICE_CHANGE'
  effectiveAt: string; changeVersion: number; subscriptionVersion: number; occurredAt: string
}

type SubscriptionTrialAuditInput = {
  eventId: string
  phase: 'REQUESTED' | 'CANCEL_REQUESTED' | 'STARTED' | 'CANCELED'
  planId?: string
  expectedVersion?: number
  subscriptionId?: string
  trialId?: string
  planVersion?: number
  trialEndsAt?: string
  previousStatus?: 'TRIALING' | 'PAYMENT_FAILED'
  occurredAt?: string
  idempotencyKey?: string
}

type CommerceOrderAuditInput = {
  eventId: string
  orderId: string
  occurredAt: string
  status: 'CREATED'
  version: number
  currency: string
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
}

async function readBoundedAuditJson(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = request.headers.get('content-length')
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
  }
  if (!request.body) throw new Error('INVALID_COMMERCE_ORDER_AUDIT')

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
      }
      chunks.push(part.value)
    }
  } catch {
    throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
  }
}

function parseCommerceOrderAuditInput(value: unknown): CommerceOrderAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'orderId', 'occurredAt', 'status', 'version', 'currency', 'subtotalMinor', 'discountMinor', 'taxMinor', 'totalMinor'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
  }
  const safeMinor = (input: unknown): input is number =>
    typeof input === 'number' && Number.isSafeInteger(input) && input >= 0
  if (
    typeof body.orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(body.orderId) ||
    body.eventId !== 'evt_order_created_' + body.orderId ||
    typeof body.occurredAt !== 'string' || Number.isNaN(Date.parse(body.occurredAt)) ||
    body.status !== 'CREATED' ||
    typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1 ||
    typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency) ||
    !safeMinor(body.subtotalMinor) || !safeMinor(body.discountMinor) ||
    !safeMinor(body.taxMinor) || !safeMinor(body.totalMinor) ||
    body.discountMinor > body.subtotalMinor ||
    !Number.isSafeInteger(body.subtotalMinor - body.discountMinor + body.taxMinor) ||
    body.totalMinor !== body.subtotalMinor - body.discountMinor + body.taxMinor
  ) throw new Error('INVALID_COMMERCE_ORDER_AUDIT')
  return body as CommerceOrderAuditInput
}

type StoredAuditEvent = {
  event_id: string
  actor_json: string
  action: string
  target_type: string
  target_id: string
  before_json: string
  after_json: string
  occurred_at: string
}

function parseMembershipPlanAuditInput(value: unknown): MembershipPlanAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'planVersion', 'status', 'visibility', 'occurredAt', 'name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'trialDays'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_MEMBERSHIP_PLAN_AUDIT')
  }
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    body.eventId !== 'evt_mpl_created_' + body.planId ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    body.planVersion !== 1 || body.status !== 'DRAFT' || body.visibility !== 'PRIVATE' ||
    typeof body.occurredAt !== 'string' || !body.occurredAt || Number.isNaN(Date.parse(body.occurredAt)) ||
    typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 120 ||
    typeof body.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(body.tier) ||
    (body.billingInterval !== 'MONTHLY' && body.billingInterval !== 'YEARLY') ||
    typeof body.priceMinor !== 'number' || !Number.isSafeInteger(body.priceMinor) || body.priceMinor < 0 || body.priceMinor > 2_147_483_647 ||
    typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency) ||
    !Number.isSafeInteger(body.trialDays) || (body.trialDays as number) < 0 || (body.trialDays as number) > 90
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_AUDIT')
  return body as MembershipPlanAuditInput
}



function parseMembershipPlanUpdateTerms(body: Record<string, unknown>): void {
  if (
    typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 120 ||
    typeof body.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(body.tier) ||
    (body.billingInterval !== 'MONTHLY' && body.billingInterval !== 'YEARLY') ||
    typeof body.priceMinor !== 'number' || !Number.isSafeInteger(body.priceMinor) ||
    body.priceMinor < 0 || body.priceMinor > 2_147_483_647 ||
    typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency) ||
    !Array.isArray(body.benefits) || body.benefits.length > 20 ||
    body.benefits.some((item) => typeof item !== 'string' || item.trim() !== item || item.length < 1 || item.length > 180) ||
    new Set(body.benefits).size !== body.benefits.length ||
    JSON.stringify(body.benefits).length > 8192 ||
    (body.trialDays !== undefined && (!Number.isSafeInteger(body.trialDays) || (body.trialDays as number) < 0 || (body.trialDays as number) > 90))
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_AUDIT')
}

function parseMembershipPlanUpdateRequestAuditInput(value: unknown): MembershipPlanUpdateRequestAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_REQUEST_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'expectedVersion', 'idempotencyKey', 'name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'benefits', 'trialDays'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_REQUEST_AUDIT')
  }
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
    typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.idempotencyKey) ||
    body.eventId !== 'evt_mpl_update_requested_' + body.planId + '_' + body.idempotencyKey
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_REQUEST_AUDIT')
  parseMembershipPlanUpdateTerms(body)
  return body as MembershipPlanUpdateRequestAuditInput
}

function parseMembershipPlanLifecycleRequestAuditInput(value: unknown): MembershipPlanLifecycleRequestAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_LIFECYCLE_REQUEST_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'expectedVersion', 'action', 'requestedStatus', 'requestedVisibility'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) throw new Error('INVALID_MEMBERSHIP_PLAN_LIFECYCLE_REQUEST_AUDIT')
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
    (body.action !== 'pause' && body.action !== 'resume' && body.action !== 'retire') ||
    body.requestedStatus !== (body.action === 'pause' ? 'PAUSED' : body.action === 'resume' ? 'ACTIVE' : 'RETIRED') ||
    body.requestedVisibility !== (body.action === 'resume' ? 'PUBLIC' : 'PRIVATE') ||
    body.eventId !== 'evt_mpl_lifecycle_requested_' + body.action + '_' + body.planId + '_v' + body.expectedVersion
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_LIFECYCLE_REQUEST_AUDIT')
  return body as MembershipPlanLifecycleRequestAuditInput
}

function parseMembershipPlanLifecycleAuditInput(value: unknown): MembershipPlanLifecycleAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_LIFECYCLE_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'expectedVersion', 'planVersion', 'action', 'status', 'visibility', 'version', 'occurredAt'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) throw new Error('INVALID_MEMBERSHIP_PLAN_LIFECYCLE_AUDIT')
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
    typeof body.planVersion !== 'number' || !Number.isSafeInteger(body.planVersion) || body.planVersion < 1 ||
    (body.action !== 'pause' && body.action !== 'resume' && body.action !== 'retire') ||
    body.status !== (body.action === 'pause' ? 'PAUSED' : body.action === 'resume' ? 'ACTIVE' : 'RETIRED') ||
    body.visibility !== (body.action === 'resume' ? 'PUBLIC' : 'PRIVATE') ||
    typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version !== body.expectedVersion + 1 ||
    body.eventId !== 'evt_mpl_plan_' + (body.action === 'pause' ? 'paused' : body.action === 'resume' ? 'activated' : 'retired') + '_' + body.planId + '_v' + body.version ||
    typeof body.occurredAt !== 'string' || !body.occurredAt || Number.isNaN(Date.parse(body.occurredAt))
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_LIFECYCLE_AUDIT')
  return body as MembershipPlanLifecycleAuditInput
}

function parseSubscriptionPlanChangeRequestAuditInput(value: unknown): SubscriptionPlanChangeRequestAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SUBSCRIPTION_PLAN_CHANGE_REQUEST_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'subscriptionId', 'targetPlanId', 'expectedVersion', 'idempotencyKey'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_SUBSCRIPTION_PLAN_CHANGE_REQUEST_AUDIT')
  }
  if (
    typeof body.eventId !== 'string' || !/^evt_sub_plan_change_request_[a-f0-9]{26}$/.test(body.eventId) ||
    typeof body.subscriptionId !== 'string' || !resourceIdPattern.test(body.subscriptionId) ||
    typeof body.targetPlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.targetPlanId) ||
    !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1 ||
    typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.idempotencyKey)
  ) throw new Error('INVALID_SUBSCRIPTION_PLAN_CHANGE_REQUEST_AUDIT')
  return body as SubscriptionPlanChangeRequestAuditInput
}

function parseSubscriptionPlanChangeAuditInput(value: unknown): SubscriptionPlanChangeAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SUBSCRIPTION_PLAN_CHANGE_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set([
    'eventId', 'changeId', 'subscriptionId', 'sourcePlanId', 'sourcePlanVersion',
    'targetPlanId', 'targetPlanVersion', 'changeType', 'effectiveAt',
    'changeVersion', 'subscriptionVersion', 'occurredAt',
  ])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_SUBSCRIPTION_PLAN_CHANGE_AUDIT')
  }
  if (
    typeof body.changeId !== 'string' || !/^spc_[A-Za-z0-9]{26}$/.test(body.changeId) ||
    body.eventId !== 'evt_subscription_plan_change_scheduled_' + body.changeId ||
    typeof body.subscriptionId !== 'string' || !resourceIdPattern.test(body.subscriptionId) ||
    typeof body.sourcePlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.sourcePlanId) ||
    typeof body.targetPlanId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.targetPlanId) ||
    !Number.isSafeInteger(body.sourcePlanVersion) || (body.sourcePlanVersion as number) < 1 ||
    !Number.isSafeInteger(body.targetPlanVersion) || (body.targetPlanVersion as number) < 1 ||
    (body.changeType !== 'DOWNGRADE' && body.changeType !== 'BILLING_INTERVAL_CHANGE' && body.changeType !== 'SAME_PRICE_CHANGE') ||
    typeof body.effectiveAt !== 'string' || !body.effectiveAt || Number.isNaN(Date.parse(body.effectiveAt)) ||
    !Number.isSafeInteger(body.changeVersion) || (body.changeVersion as number) < 1 ||
    !Number.isSafeInteger(body.subscriptionVersion) || (body.subscriptionVersion as number) < 1 ||
    typeof body.occurredAt !== 'string' || !body.occurredAt || Number.isNaN(Date.parse(body.occurredAt))
  ) throw new Error('INVALID_SUBSCRIPTION_PLAN_CHANGE_AUDIT')
  return body as SubscriptionPlanChangeAuditInput
}

function parseMembershipPlanUpdateAuditInput(value: unknown): MembershipPlanUpdateAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'expectedVersion', 'planVersion', 'status', 'visibility', 'version', 'occurredAt', 'name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'benefits', 'trialDays'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_AUDIT')
  }
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
    typeof body.planVersion !== 'number' || !Number.isSafeInteger(body.planVersion) || body.planVersion < 2 ||
    (body.status !== 'DRAFT' && body.status !== 'ACTIVE' && body.status !== 'PAUSED') ||
    (body.visibility !== 'PRIVATE' && body.visibility !== 'PUBLIC') ||
    typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version !== body.expectedVersion + 1 ||
    body.eventId !== 'evt_mpl_updated_' + body.planId + '_v' + body.version ||
    !Number.isSafeInteger(body.trialDays) || (body.trialDays as number) < 0 || (body.trialDays as number) > 90 ||
    typeof body.occurredAt !== 'string' || !body.occurredAt || Number.isNaN(Date.parse(body.occurredAt))
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_UPDATE_AUDIT')
  parseMembershipPlanUpdateTerms(body)
  return body as MembershipPlanUpdateAuditInput
}

function parseMembershipPlanPublishAuditInput(value: unknown): MembershipPlanPublishAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_PUBLISH_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'planVersion', 'status', 'visibility', 'version', 'occurredAt', 'name', 'tier', 'billingInterval', 'priceMinor', 'currency', 'trialDays'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_MEMBERSHIP_PLAN_PUBLISH_AUDIT')
  }
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    typeof body.planVersion !== 'number' || !Number.isSafeInteger(body.planVersion) || body.planVersion < 1 ||
    body.status !== 'ACTIVE' || body.visibility !== 'PUBLIC' ||
    typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 2 ||
    body.eventId !== 'evt_mpl_published_' + body.planId + '_v' + body.version ||
    typeof body.occurredAt !== 'string' || !body.occurredAt || Number.isNaN(Date.parse(body.occurredAt)) ||
    typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.length > 120 ||
    typeof body.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(body.tier) ||
    (body.billingInterval !== 'MONTHLY' && body.billingInterval !== 'YEARLY') ||
    typeof body.priceMinor !== 'number' || !Number.isSafeInteger(body.priceMinor) || body.priceMinor < 0 || body.priceMinor > 2_147_483_647 ||
    typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency) ||
    !Number.isSafeInteger(body.trialDays) || (body.trialDays as number) < 0 || (body.trialDays as number) > 90
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_PUBLISH_AUDIT')
  return body as MembershipPlanPublishAuditInput
}


function parseMembershipPlanPublishRequestAuditInput(value: unknown): MembershipPlanPublishRequestAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_MEMBERSHIP_PLAN_PUBLISH_REQUEST_AUDIT')
  const body = value as Record<string, unknown>
  const allowed = new Set(['eventId', 'planId', 'creatorId', 'expectedVersion', 'requestedStatus', 'requestedVisibility'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size) {
    throw new Error('INVALID_MEMBERSHIP_PLAN_PUBLISH_REQUEST_AUDIT')
  }
  if (
    typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId) ||
    typeof body.creatorId !== 'string' || !resourceIdPattern.test(body.creatorId) ||
    typeof body.expectedVersion !== 'number' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
    body.requestedStatus !== 'ACTIVE' || body.requestedVisibility !== 'PUBLIC' ||
    body.eventId !== 'evt_mpl_publish_requested_' + body.planId + '_v' + body.expectedVersion
  ) throw new Error('INVALID_MEMBERSHIP_PLAN_PUBLISH_REQUEST_AUDIT')
  return body as MembershipPlanPublishRequestAuditInput
}

function parseSubscriptionTrialAuditInput(value: unknown): SubscriptionTrialAuditInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
  const body = value as Record<string, unknown>
  const phase = body.phase
  const common = ['eventId', 'phase', 'planId']
  if (phase !== 'REQUESTED' && phase !== 'CANCEL_REQUESTED' && phase !== 'STARTED' && phase !== 'CANCELED') {
    throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
  }
  if (phase === 'REQUESTED') {
    if (typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId)) {
      throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
    }
    const allowed = new Set([...common, 'idempotencyKey'])
    if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size ||
        typeof body.eventId !== 'string' || !/^evt_subscription_trial_request_[a-f0-9]{26}$/.test(body.eventId) ||
        typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.idempotencyKey)) {
      throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
    }
    return body as SubscriptionTrialAuditInput
  }
  if (phase === 'CANCEL_REQUESTED') {
    const allowed = new Set(['eventId', 'phase', 'subscriptionId', 'expectedVersion'])
    if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size ||
        typeof body.subscriptionId !== 'string' || !resourceIdPattern.test(body.subscriptionId) ||
        !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1 ||
        typeof body.eventId !== 'string' || !/^evt_subscription_trial_cancel_request_[a-f0-9]{26}$/.test(body.eventId)) {
      throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
    }
    return body as SubscriptionTrialAuditInput
  }
  if (typeof body.planId !== 'string' || !/^plan_[a-f0-9]{64}$/.test(body.planId)) {
    throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
  }
  const allowed = new Set([...common, 'subscriptionId', 'trialId', 'planVersion', 'trialEndsAt', 'previousStatus', 'occurredAt'])
  if (Object.keys(body).some((key) => !allowed.has(key)) || Object.keys(body).length !== allowed.size ||
      typeof body.subscriptionId !== 'string' || !resourceIdPattern.test(body.subscriptionId) ||
      typeof body.trialId !== 'string' || !/^mtr_[A-Za-z0-9]{26}$/.test(body.trialId) ||
      !Number.isSafeInteger(body.planVersion) || (body.planVersion as number) < 1 ||
      typeof body.trialEndsAt !== 'string' || !body.trialEndsAt ||
      Number.isNaN(Date.parse(body.trialEndsAt)) ||
      typeof body.occurredAt !== 'string' || !body.occurredAt || Number.isNaN(Date.parse(body.occurredAt)) ||
      (phase === 'CANCELED' && body.previousStatus !== 'TRIALING' && body.previousStatus !== 'PAYMENT_FAILED') ||
      (phase === 'STARTED' && body.previousStatus !== undefined) ||
      body.eventId !== 'evt_subscription_trial_' + (phase === 'STARTED' ? 'started_' : 'canceled_') + body.trialId) {
    throw new Error('INVALID_SUBSCRIPTION_TRIAL_AUDIT')
  }
  return body as SubscriptionTrialAuditInput
}

function matchesMembershipPlanMutationRequestAudit(existing: StoredAuditEvent, expected: AuditEvent): boolean {
  try {
    const storedActor = JSON.parse(existing.actor_json) as Record<string, unknown>
    const expectedActor = expected.actor as unknown as Record<string, unknown>
    return existing.event_id === expected.eventId &&
      storedActor.actorId === expectedActor.actorId &&
      storedActor.actorType === expectedActor.actorType &&
      storedActor.layer === expectedActor.layer &&
      existing.action === expected.action &&
      existing.target_type === expected.targetType &&
      existing.target_id === expected.targetId &&
      existing.before_json === JSON.stringify(expected.before) &&
      existing.after_json === JSON.stringify(expected.after)
  } catch {
    return false
  }
}

/**
 * The event time is assigned by W06, not sent by W01. An exact semantic retry
 * therefore ignores only the newly generated timestamp and confirms that the
 * first immutable request-intent event is already durable.
 */
async function persistMembershipPlanMutationRequestAudit(env: Env, event: AuditEvent): Promise<Response> {
  let existing: StoredAuditEvent | null
  try {
    existing = await findAuditEvent(env.D1_03, event.eventId)
  } catch {
    return json({ error: 'AUDIT_EVENT_LOOKUP_FAILED' }, 503)
  }
  if (existing) {
    if (!matchesMembershipPlanMutationRequestAudit(existing, event)) return json({ error: 'AUDIT_EVENT_CONFLICT' }, 409)
    return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId, replayed: true }, 200)
  }
  try {
    await persistAuditEvent(env.D1_03, event)
    return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId, replayed: false }, 201)
  } catch {
    try {
      const raced = await findAuditEvent(env.D1_03, event.eventId)
      if (raced && matchesMembershipPlanMutationRequestAudit(raced, event)) {
        return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId, replayed: true }, 200)
      }
    } catch {
      // Keep the mutation closed if the durable result remains uncertain.
    }
    return json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, 503)
  }
}

async function findAuditEvent(db: D1Database, eventId: string): Promise<StoredAuditEvent | null> {
  return db.prepare(
    'SELECT event_id, actor_json, action, target_type, target_id, before_json, after_json, occurred_at ' +
    'FROM audit_events WHERE event_id = ? LIMIT 1',
  ).bind(eventId).first<StoredAuditEvent>()
}

function matchesImmutableAuditEvent(existing: StoredAuditEvent, expected: AuditEvent): boolean {
  try {
    const storedActor = JSON.parse(existing.actor_json) as Record<string, unknown>
    const expectedActor = expected.actor as unknown as Record<string, unknown>
    return existing.event_id === expected.eventId &&
      storedActor.actorId === expectedActor.actorId &&
      storedActor.actorType === expectedActor.actorType &&
      storedActor.layer === expectedActor.layer &&
      existing.action === expected.action &&
      existing.target_type === expected.targetType &&
      existing.target_id === expected.targetId &&
      existing.before_json === JSON.stringify(expected.before) &&
      existing.after_json === JSON.stringify(expected.after) &&
      existing.occurred_at === expected.occurredAt
  } catch {
    return false
  }
}

async function persistImmutableAuditEvent(env: Env, event: AuditEvent): Promise<Response> {
  let existing: StoredAuditEvent | null
  try {
    existing = await findAuditEvent(env.D1_03, event.eventId)
  } catch {
    return json({ error: 'AUDIT_EVENT_LOOKUP_FAILED' }, 503)
  }
  if (existing) {
    if (!matchesImmutableAuditEvent(existing, event)) return json({ error: 'AUDIT_EVENT_CONFLICT' }, 409)
    return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId, replayed: true }, 200)
  }

  try {
    await persistAuditEvent(env.D1_03, event)
    return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId, replayed: false }, 201)
  } catch {
    // A concurrent retry may have won the unique event_id insert. Confirm the
    // durable row before treating this request as an idempotent success.
    try {
      const raced = await findAuditEvent(env.D1_03, event.eventId)
      if (raced && matchesImmutableAuditEvent(raced, event)) {
        return json({ eventId: event.eventId, action: event.action, targetType: event.targetType, targetId: event.targetId, replayed: true }, 200)
      }
    } catch {
      // Keep the response closed if the durable outcome cannot be confirmed.
    }
    return json({ error: 'AUDIT_EVENT_PERSISTENCE_FAILED' }, 503)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      await enforceRateLimit(request, env)
    } catch (error) {
      if (error instanceof ModerationRuntimeError && error.code === 'RATE_LIMITED') {
        return json({ error: { code: 'RATE_LIMITED', message: 'Too many requests', details: { retryAfter: 60 } }, requestId: canonicalRequestId() }, 429)
      }
      throw error
    }
    const url = new URL(request.url)

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ service: 'W06', status: 'ok', auditPersistence: 'enabled', d1Binding: Boolean(env.D1_03), moderationRuntime: 'enabled' })
    }

    if (request.method === 'POST' && url.pathname === '/reports') {
      try {
        const principal = requireW01Transport(request)
        const permission = principal.layer
        if (!/^L[0-8]$/.test(permission) || Number(permission.slice(1)) < 2) {
          throw new ReportRuntimeError('PERMISSION_DENIED', 403)
        }
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
        requireModerationPermission('listModerationQueue', principal, request)
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
        requireModerationPermission('getModerationCase', principal, request)
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
        requireModerationPermission('decideModerationCase', principal, request)
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

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/commerce-order-created') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[2-8]$/.test(principal.layer)) {
        return json({ error: 'PERMISSION_DENIED' }, 403)
      }

      let input: CommerceOrderAuditInput
      try {
        input = parseCommerceOrderAuditInput(await readBoundedAuditJson(request, 4096))
      } catch {
        return json({ error: 'INVALID_COMMERCE_ORDER_AUDIT' }, 400)
      }

      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: {
          actorId: principal.userId,
          actorType: 'user',
          layer: principal.layer as AuditEvent['actor']['layer'],
        },
        action: 'commerce.order.created',
        targetType: 'Order',
        targetId: input.orderId,
        before: {},
        after: {
          status: input.status,
          version: input.version,
          currency: input.currency,
          subtotalMinor: input.subtotalMinor,
          discountMinor: input.discountMinor,
          taxMinor: input.taxMinor,
          totalMinor: input.totalMinor,
        },
        occurredAt: input.occurredAt,
      }
      return persistImmutableAuditEvent(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-created') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) {
        return json({ error: 'PERMISSION_DENIED' }, 403)
      }

      const declaredLength = Number(request.headers.get('content-length') ?? '0')
      if (Number.isFinite(declaredLength) && declaredLength > 4096) {
        return json({ error: 'INVALID_MEMBERSHIP_PLAN_AUDIT' }, 400)
      }
      let input: MembershipPlanAuditInput
      try {
        const bodyText = await request.text()
        if (new TextEncoder().encode(bodyText).byteLength > 4096) throw new Error('INVALID_MEMBERSHIP_PLAN_AUDIT')
        input = parseMembershipPlanAuditInput(JSON.parse(bodyText) as unknown)
      } catch {
        return json({ error: 'INVALID_MEMBERSHIP_PLAN_AUDIT' }, 400)
      }

      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: {
          actorId: principal.userId,
          actorType: 'user',
          layer: principal.layer as AuditEvent['actor']['layer'],
        },
        action: 'membership.plan.created',
        targetType: 'MembershipPlan',
        targetId: input.planId,
        before: {},
        after: {
          creatorId: input.creatorId,
          planVersion: input.planVersion,
          trialDays: input.trialDays,
          status: input.status,
          visibility: input.visibility,
          name: input.name,
          tier: input.tier,
          billingInterval: input.billingInterval,
          priceMinor: input.priceMinor,
          currency: input.currency,
          trialDays: input.trialDays,
        },
        occurredAt: input.occurredAt,
      }
      return persistImmutableAuditEvent(env, event)
    }



    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-publish-requested') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) {
        return json({ error: 'PERMISSION_DENIED' }, 403)
      }
      let input: MembershipPlanPublishRequestAuditInput
      try {
        input = parseMembershipPlanPublishRequestAuditInput(await readBoundedAuditJson(request, 2048))
      } catch {
        return json({ error: 'INVALID_MEMBERSHIP_PLAN_PUBLISH_REQUEST_AUDIT' }, 400)
      }
      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: {
          actorId: principal.userId,
          actorType: 'user',
          layer: principal.layer as AuditEvent['actor']['layer'],
        },
        action: 'membership.plan.publish_requested',
        targetType: 'MembershipPlan',
        targetId: input.planId,
        before: {
          creatorId: input.creatorId,
          expectedVersion: input.expectedVersion,
        },
        after: {
          creatorId: input.creatorId,
          expectedVersion: input.expectedVersion,
          requestedStatus: input.requestedStatus,
          requestedVisibility: input.requestedVisibility,
        },
        occurredAt: new Date().toISOString(),
      }
      return persistMembershipPlanMutationRequestAudit(env, event)
    }


    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-lifecycle-requested') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: MembershipPlanLifecycleRequestAuditInput
      try { input = parseMembershipPlanLifecycleRequestAuditInput(await readBoundedAuditJson(request, 2048)) }
      catch { return json({ error: 'INVALID_MEMBERSHIP_PLAN_LIFECYCLE_REQUEST_AUDIT' }, 400) }
      const event: AuditEvent = {
        eventId: input.eventId, requestId: principal.requestId, traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: 'membership.plan.lifecycle_requested', targetType: 'MembershipPlan', targetId: input.planId,
        before: { creatorId: input.creatorId, expectedVersion: input.expectedVersion },
        after: { creatorId: input.creatorId, expectedVersion: input.expectedVersion, action: input.action,
          requestedStatus: input.requestedStatus, requestedVisibility: input.requestedVisibility },
        occurredAt: new Date().toISOString(),
      }
      return persistMembershipPlanMutationRequestAudit(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-update-requested') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: MembershipPlanUpdateRequestAuditInput
      try { input = parseMembershipPlanUpdateRequestAuditInput(await readBoundedAuditJson(request, 4096)) }
      catch { return json({ error: 'INVALID_MEMBERSHIP_PLAN_UPDATE_REQUEST_AUDIT' }, 400) }
      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: 'membership.plan.update_requested',
        targetType: 'MembershipPlan',
        targetId: input.planId,
        before: { creatorId: input.creatorId, expectedVersion: input.expectedVersion },
        after: {
          creatorId: input.creatorId,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
          name: input.name,
          tier: input.tier,
          billingInterval: input.billingInterval,
          priceMinor: input.priceMinor,
          currency: input.currency,
          benefits: input.benefits,
          ...(input.trialDays === undefined ? {} : { trialDays: input.trialDays }),
        },
        occurredAt: new Date().toISOString(),
      }
      return persistMembershipPlanMutationRequestAudit(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/subscription-plan-change-requested') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[2-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: SubscriptionPlanChangeRequestAuditInput
      try { input = parseSubscriptionPlanChangeRequestAuditInput(await readBoundedAuditJson(request, 2048)) }
      catch { return json({ error: 'INVALID_SUBSCRIPTION_PLAN_CHANGE_REQUEST_AUDIT' }, 400) }
      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: 'membership.subscription.plan_change_requested',
        targetType: 'Subscription',
        targetId: input.subscriptionId,
        before: { expectedVersion: input.expectedVersion },
        after: {
          targetPlanId: input.targetPlanId,
          idempotencyKey: input.idempotencyKey,
        },
        occurredAt: new Date().toISOString(),
      }
      return persistImmutableAuditEvent(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/subscription-plan-change-scheduled') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[2-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: SubscriptionPlanChangeAuditInput
      try { input = parseSubscriptionPlanChangeAuditInput(await readBoundedAuditJson(request, 2048)) }
      catch { return json({ error: 'INVALID_SUBSCRIPTION_PLAN_CHANGE_AUDIT' }, 400) }
      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: 'membership.subscription.plan_change_scheduled',
        targetType: 'Subscription',
        targetId: input.subscriptionId,
        before: {
          planId: input.sourcePlanId,
          planVersion: input.sourcePlanVersion,
        },
        after: {
          changeId: input.changeId,
          planId: input.targetPlanId,
          planVersion: input.targetPlanVersion,
          changeType: input.changeType,
          effectiveAt: input.effectiveAt,
          changeVersion: input.changeVersion,
          subscriptionVersion: input.subscriptionVersion,
        },
        occurredAt: input.occurredAt,
      }
      return persistImmutableAuditEvent(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/subscription-trial') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[2-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: SubscriptionTrialAuditInput
      try { input = parseSubscriptionTrialAuditInput(await readBoundedAuditJson(request, 2048)) }
      catch { return json({ error: 'INVALID_SUBSCRIPTION_TRIAL_AUDIT' }, 400) }
      const requested = input.phase === 'REQUESTED'
      const cancelRequested = input.phase === 'CANCEL_REQUESTED'
      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: requested
          ? 'membership.subscription.trial_requested'
          : cancelRequested
            ? 'membership.subscription.trial_cancel_requested'
            : input.phase === 'STARTED'
              ? 'membership.subscription.trial_started'
              : 'membership.subscription.trial_canceled',
        targetType: requested ? 'MembershipPlan' : 'Subscription',
        targetId: requested ? input.planId! : input.subscriptionId!,
        before: requested
          ? { status: 'NOT_STARTED' }
          : cancelRequested
            ? { status: 'TRIALING_OR_PAYMENT_FAILED', version: input.expectedVersion }
            : { status: input.phase === 'STARTED' ? 'NOT_STARTED' : input.previousStatus },
        after: requested
          ? { planId: input.planId, idempotencyKey: input.idempotencyKey }
          : cancelRequested
            ? { cancellationRequested: true, expectedVersion: input.expectedVersion }
            : {
                trialId: input.trialId,
                planId: input.planId,
                planVersion: input.planVersion,
                status: input.phase === 'STARTED' ? 'TRIALING' : 'CANCELED',
                trialEndsAt: input.trialEndsAt,
              },
        occurredAt: requested ? new Date().toISOString() : input.occurredAt!,
      }
      return requested
        ? persistMembershipPlanMutationRequestAudit(env, event)
        : persistImmutableAuditEvent(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-lifecycle-changed') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: MembershipPlanLifecycleAuditInput
      try { input = parseMembershipPlanLifecycleAuditInput(await readBoundedAuditJson(request, 2048)) }
      catch { return json({ error: 'INVALID_MEMBERSHIP_PLAN_LIFECYCLE_AUDIT' }, 400) }
      const event: AuditEvent = {
        eventId: input.eventId, requestId: principal.requestId, traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: input.action === 'pause' ? 'membership.plan.paused' : input.action === 'resume' ? 'membership.plan.activated' : 'membership.plan.retired',
        targetType: 'MembershipPlan', targetId: input.planId,
        before: { creatorId: input.creatorId, planVersion: input.planVersion,
          status: input.action === 'pause' ? 'ACTIVE' : 'PAUSED',
          visibility: input.action === 'pause' ? 'PUBLIC' : 'PRIVATE', version: input.expectedVersion },
        after: { creatorId: input.creatorId, planVersion: input.planVersion,
          status: input.status, visibility: input.visibility, version: input.version },
        occurredAt: input.occurredAt,
      }
      return persistImmutableAuditEvent(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-updated') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) return json({ error: 'PERMISSION_DENIED' }, 403)
      let input: MembershipPlanUpdateAuditInput
      try { input = parseMembershipPlanUpdateAuditInput(await readBoundedAuditJson(request, 6144)) }
      catch { return json({ error: 'INVALID_MEMBERSHIP_PLAN_UPDATE_AUDIT' }, 400) }
      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: { actorId: principal.userId, actorType: 'user', layer: principal.layer as AuditEvent['actor']['layer'] },
        action: 'membership.plan.updated',
        targetType: 'MembershipPlan',
        targetId: input.planId,
        before: {
          creatorId: input.creatorId,
          expectedVersion: input.expectedVersion,
          planVersion: input.planVersion - 1,
        },
        after: {
          creatorId: input.creatorId,
          expectedVersion: input.expectedVersion,
          planVersion: input.planVersion,
          version: input.version,
          status: input.status,
          visibility: input.visibility,
          name: input.name,
          tier: input.tier,
          billingInterval: input.billingInterval,
          priceMinor: input.priceMinor,
          currency: input.currency,
          benefits: input.benefits,
          trialDays: input.trialDays,
        },
        occurredAt: input.occurredAt,
      }
      return persistImmutableAuditEvent(env, event)
    }

    if (request.method === 'POST' && url.pathname === '/internal/audit-events/membership-plan-published') {
      let principal: ReturnType<typeof requireW01Transport>
      try { principal = requireW01Transport(request) }
      catch (error) { return errorResponse(error, request.headers.get('X-LuckRead-Request-Id')?.trim()) }
      if (!/^L[3-8]$/.test(principal.layer)) {
        return json({ error: 'PERMISSION_DENIED' }, 403)
      }

      let input: MembershipPlanPublishAuditInput
      try {
        input = parseMembershipPlanPublishAuditInput(await readBoundedAuditJson(request, 4096))
      } catch {
        return json({ error: 'INVALID_MEMBERSHIP_PLAN_PUBLISH_AUDIT' }, 400)
      }

      const event: AuditEvent = {
        eventId: input.eventId,
        requestId: principal.requestId,
        traceId: principal.correlationId,
        actor: {
          actorId: principal.userId,
          actorType: 'user',
          layer: principal.layer as AuditEvent['actor']['layer'],
        },
        action: 'membership.plan.published',
        targetType: 'MembershipPlan',
        targetId: input.planId,
        before: {
          creatorId: input.creatorId,
          planVersion: input.planVersion,
          status: 'DRAFT',
          visibility: 'PRIVATE',
          version: input.version - 1,
        },
        after: {
          creatorId: input.creatorId,
          planVersion: input.planVersion,
          status: input.status,
          visibility: input.visibility,
          version: input.version,
          name: input.name,
          tier: input.tier,
          billingInterval: input.billingInterval,
          priceMinor: input.priceMinor,
          currency: input.currency,
          trialDays: input.trialDays,
        },
        occurredAt: input.occurredAt,
      }
      return persistImmutableAuditEvent(env, event)
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
    await processQueueBatch(batch, async (raw) => {
      try {
        parseEventEnvelopeMetadata(raw)
        const body = raw && typeof raw === 'object'
          ? raw as Record<string, unknown>
          : null
        if (typeof body?.eventType === 'string' && body.eventType.startsWith('auth.mfa.')) {
          await consumeMfaAuditEvent(env.D1_03, raw)
        } else {
          await consumeAccountStateChanged(env.D1_03, raw)
        }
      } catch (error) {
        if (error instanceof Error &&
            (error.message === 'INVALID_AUTH_013_EVENT' || error.message === 'INVALID_AUTH_007_MFA_EVENT')) {
          throw new QueueTaskFailure('Invalid W06 audit queue event', 'poison', error.message)
        }
        if (error instanceof Error && error.message === 'MFA_AUDIT_EVENT_IDENTITY_CONFLICT') {
          throw new QueueTaskFailure('Conflicting W06 audit event identity', 'permanent', error.message)
        }
        // Unknown/storage failures remain transient; event consumers own validation and idempotency.
        throw error
      }
    })
  },
}
