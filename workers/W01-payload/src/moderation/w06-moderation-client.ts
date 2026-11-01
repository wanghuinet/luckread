import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { ContentPrincipal } from '../content/w03-content-client.js'

type W06ModerationService = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

export class W06ModerationClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export type W06ModerationPermissionContext = Readonly<{
  decision: 'ALLOW'
  permission: 'moderation.queue.read' | 'moderation.case.read' | 'moderation.decide'
  resourceType: 'ModerationQueue' | 'ModerationCase'
  policyVersion: 'casl-l0-l8-v1'
  subjectId: string
  layer: string
}>

async function getW06Service(): Promise<W06ModerationService> {
  const context = await getCloudflareContext({ async: true })
  const service = (context.env as unknown as { W06_MODERATION?: W06ModerationService }).W06_MODERATION
  if (!service) throw new W06ModerationClientError(503, 'SERVICE_UNAVAILABLE', 'Moderation service unavailable')
  return service
}

const requestId = (request: Request): string => {
  const value = request.headers.get('X-LuckRead-Request-Id')?.trim()
  return value && /^req_[A-Za-z0-9_-]{1,123}$/.test(value)
    ? value
    : `req_${crypto.randomUUID().replaceAll('-', '')}`
}

/** Dedicated fixed route for the durable membership-plan audit record. */
export async function callW06MembershipPlanAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
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
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/membership-plan-created',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}



/** Durable intent record written before a membership plan becomes public. */
export async function callW06MembershipPlanPublishRequestAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
    eventId: string
    planId: string
    creatorId: string
    expectedVersion: number
    requestedStatus: 'ACTIVE'
    requestedVisibility: 'PUBLIC'
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/membership-plan-publish-requested',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}

/** Dedicated durable audit path for publishing an owned membership plan. */
export async function callW06MembershipPlanPublishAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
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
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/membership-plan-published',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}


/** Durable intent event written before membership plan commercial terms change. */
export async function callW06MembershipPlanUpdateRequestAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
    eventId: string; planId: string; creatorId: string; expectedVersion: number; idempotencyKey: string
    name: string; tier: string; billingInterval: 'MONTHLY' | 'YEARLY'
    priceMinor: number; currency: string; benefits: string[]
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/membership-plan-update-requested',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}

/** Immutable audit of a newly selected commercial plan version. */
export async function callW06MembershipPlanUpdateAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
    eventId: string; planId: string; creatorId: string; expectedVersion: number
    planVersion: number; status: 'DRAFT' | 'ACTIVE' | 'PAUSED'; visibility: 'PRIVATE' | 'PUBLIC'
    version: number; occurredAt: string; name: string; tier: string
    billingInterval: 'MONTHLY' | 'YEARLY'; priceMinor: number; currency: string; benefits: string[]
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/membership-plan-updated',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}

/** Durable intent record written before changing a plan's sale-availability state. */
export async function callW06MembershipPlanLifecycleRequestAudit(input: {
  request: Request; principal: ContentPrincipal
  body: { eventId: string; planId: string; creatorId: string; expectedVersion: number; action: 'pause' | 'resume' | 'retire'; requestedStatus: 'PAUSED' | 'ACTIVE' | 'RETIRED'; requestedVisibility: 'PRIVATE' | 'PUBLIC' }
}): Promise<Response> {
  return callW06Moderation({ request: input.request, pathname: '/internal/audit-events/membership-plan-lifecycle-requested', method: 'POST', principal: input.principal, body: input.body })
}

/** Immutable audit for pausing/resuming sales or retiring a paused membership plan. */
export async function callW06MembershipPlanLifecycleAudit(input: {
  request: Request; principal: ContentPrincipal
  body: { eventId: string; planId: string; creatorId: string; expectedVersion: number; planVersion: number; action: 'pause' | 'resume' | 'retire'; status: 'PAUSED' | 'ACTIVE' | 'RETIRED'; visibility: 'PRIVATE' | 'PUBLIC'; version: number; occurredAt: string }
}): Promise<Response> {
  return callW06Moderation({ request: input.request, pathname: '/internal/audit-events/membership-plan-lifecycle-changed', method: 'POST', principal: input.principal, body: input.body })
}

/** Durable audit of an authenticated subscriber's requested paid plan upgrade. */
export async function callW06SubscriptionPlanChangeRequestAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
    eventId: string
    attemptId: string
    subscriberId: string
    subscriptionId: string
    targetPlanId: string
    changeType: 'UPGRADE' | 'DOWNGRADE_SCHEDULE' | 'BILLING_INTERVAL_CHANGE_SCHEDULE'
    expectedEtag: string
    requestedAt: string
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/subscription-plan-change-requested',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}

/** Dedicated durable audit path for a validated, newly created W07 Order DTO. */
export async function callW06CommerceOrderAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
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
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/commerce-order-created',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}

export async function callW06PaymentMethodRevocationRequestAudit(input: {
  request: Request
  principal: ContentPrincipal
  body: {
    eventId: string
    savedPaymentMethodId: string
    idempotencyKey: string
  }
}): Promise<Response> {
  return callW06Moderation({
    request: input.request,
    pathname: '/internal/audit-events/payment-method-revocation-requested',
    method: 'POST',
    principal: input.principal,
    body: input.body,
  })
}

export async function callW06Moderation(input: {
  request: Request
  pathname: string
  method: string
  principal: ContentPrincipal
  body?: unknown
  permissionContext?: W06ModerationPermissionContext
}): Promise<Response> {
  if (!input.principal.userId || !input.principal.layer) {
    return Response.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required', details: {} }, requestId: `req_${crypto.randomUUID()}` },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  const service = await getW06Service()
  const headers = new Headers({
    'X-LuckRead-Caller': 'W01',
    'X-LuckRead-Transport-Version': '1.0',
    'X-LuckRead-Principal-User-Id': input.principal.userId,
    'X-LuckRead-Principal-Layer': input.principal.layer,
    'X-LuckRead-Correlation-Id':
      input.request.headers.get('X-LuckRead-Correlation-Id')?.trim() || crypto.randomUUID(),
    'X-LuckRead-Request-Id': requestId(input.request),
  })
  if (input.permissionContext) {
    headers.set('X-LuckRead-Authz-Decision', input.permissionContext.decision)
    headers.set('X-LuckRead-Authz-Permission', input.permissionContext.permission)
    headers.set('X-LuckRead-Authz-Resource-Type', input.permissionContext.resourceType)
    headers.set('X-LuckRead-Authz-Policy-Version', input.permissionContext.policyVersion)
    headers.set('X-LuckRead-Authz-Subject-Id', input.permissionContext.subjectId)
    headers.set('X-LuckRead-Authz-Layer', input.permissionContext.layer)
  }

  const ifMatch = input.request.headers.get('If-Match')
  const idempotencyKey = input.request.headers.get('Idempotency-Key')
  if (ifMatch) headers.set('If-Match', ifMatch)
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)

  let body: BodyInit | undefined
  if (input.body !== undefined) {
    headers.set('content-type', 'application/json; charset=utf-8')
    body = JSON.stringify(input.body)
  }

  const response = await service.fetch(
    new Request(`https://luckread-w06.internal${input.pathname}`, {
      method: input.method,
      headers,
      body,
    }),
  )

  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
