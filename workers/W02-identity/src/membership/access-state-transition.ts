export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
export type SubscriptionActor = 'system' | 'payment' | 'user' | 'creator' | 'admin'
export type EntitlementAction = 'NONE' | 'GRANT' | 'REVOKE'

const transitions: Record<string, readonly SubscriptionActor[]> = {
  'PENDING:ACTIVE': ['system', 'payment'],
  'ACTIVE:PAST_DUE': ['system', 'payment'],
  'PAST_DUE:ACTIVE': ['system', 'payment'],
  'ACTIVE:CANCELED': ['user', 'creator', 'admin', 'system'],
  'PAST_DUE:CANCELED': ['admin', 'system'],
  'ACTIVE:EXPIRED': ['system'],
  'PAST_DUE:EXPIRED': ['system'],
}

export type MembershipPrincipal = {
  caller: string
  transportVersion: string
  correlationId: string
  actorUserId: string
  idempotencyKey: string
}

export type CreateSubscriptionInput = MembershipPrincipal & {
  subscriptionId: string
  subscriberId: string
  planId: string
  planVersion: number
  startedAt: string
  currentPeriodStart: string
  currentPeriodEnd: string
}

export type TransitionInput = MembershipPrincipal & {
  subscriptionId: string
  from: SubscriptionStatus
  to: SubscriptionStatus
  expectedVersion: number
  actor: SubscriptionActor
  entitlementAction: EntitlementAction
  entitlementId?: string
  entitlementType?: string
  scopeType?: string
  scopeId?: string
  sourcePlanVersion?: number
  effectiveAt?: string
  expiresAt?: string | null
}

export class MembershipAccessStateError extends Error {
  constructor(readonly code: string) { super(code) }
}

const validId = (value: string): boolean => value.length > 0 && value.length <= 128

function validatePrincipal(input: MembershipPrincipal): void {
  if (input.caller !== 'W07') throw new MembershipAccessStateError('UNTRUSTED_CALLER')
  if (input.transportVersion !== '1.0') throw new MembershipAccessStateError('UNSUPPORTED_TRANSPORT')
  if (!validId(input.actorUserId)) throw new MembershipAccessStateError('INVALID_PRINCIPAL')
  if (!input.correlationId || input.correlationId.length > 128) throw new MembershipAccessStateError('INVALID_CORRELATION')
  if (!input.idempotencyKey || input.idempotencyKey.length > 256) throw new MembershipAccessStateError('IDEMPOTENCY_KEY_REQUIRED')
}

export function validateCreateSubscription(input: CreateSubscriptionInput): void {
  validatePrincipal(input)
  if (!validId(input.subscriptionId) || !validId(input.subscriberId) || !validId(input.planId)) {
    throw new MembershipAccessStateError('INVALID_IDENTIFIER')
  }
  if (input.actorUserId !== input.subscriberId) {
    throw new MembershipAccessStateError('PRINCIPAL_SCOPE_DENIED')
  }
  if (!Number.isSafeInteger(input.planVersion) || input.planVersion < 1) {
    throw new MembershipAccessStateError('INVALID_PLAN_VERSION')
  }
}

export function validateTransition(input: TransitionInput): void {
  validatePrincipal(input)
  if (!validId(input.subscriptionId)) throw new MembershipAccessStateError('INVALID_IDENTIFIER')
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new MembershipAccessStateError('INVALID_EXPECTED_VERSION')
  }
  if (!transitions[input.from + ':' + input.to]) {
    throw new MembershipAccessStateError('INVALID_STATE_TRANSITION')
  }
  if (!transitions[input.from + ':' + input.to].includes(input.actor)) {
    throw new MembershipAccessStateError('ACTOR_NOT_ALLOWED')
  }
  if (input.to === 'ACTIVE' && input.entitlementAction !== 'GRANT') {
    throw new MembershipAccessStateError('INVALID_ENTITLEMENT_GRANT')
  }
  if ((input.to === 'CANCELED' || input.to === 'EXPIRED') && input.entitlementAction !== 'REVOKE') {
    throw new MembershipAccessStateError('INVALID_ENTITLEMENT_REVOKE')
  }
  if (input.entitlementAction === 'GRANT') {
    if (input.to !== 'ACTIVE' || !input.entitlementId || !input.entitlementType || !input.scopeType || !input.scopeId || !input.sourcePlanVersion) {
      throw new MembershipAccessStateError('INVALID_ENTITLEMENT_GRANT')
    }
  }
  if (input.entitlementAction === 'REVOKE' && !input.entitlementId) {
    throw new MembershipAccessStateError('INVALID_ENTITLEMENT_REVOKE')
  }
}

export function mapMembershipError(error: unknown): { status: number; code: string } {
  const code = error instanceof MembershipAccessStateError ? error.code : 'SERVICE_UNAVAILABLE'
  const status =
    code === 'UNTRUSTED_CALLER' || code === 'UNSUPPORTED_TRANSPORT' ||
    code === 'INVALID_PRINCIPAL' || code === 'INVALID_CORRELATION' ||
    code === 'IDEMPOTENCY_KEY_REQUIRED' || code === 'INVALID_IDENTIFIER' ||
    code === 'INVALID_PLAN_VERSION' || code === 'INVALID_EXPECTED_VERSION' ||
    code === 'INVALID_ENTITLEMENT_GRANT' || code === 'INVALID_ENTITLEMENT_REVOKE'
      ? 400
      : code === 'PRINCIPAL_SCOPE_DENIED' || code === 'ACTOR_NOT_ALLOWED'
        ? 403
        : code === 'INVALID_STATE_TRANSITION' || code === 'VERSION_CONFLICT'
          ? 409
          : 503
  return { status, code }
}
