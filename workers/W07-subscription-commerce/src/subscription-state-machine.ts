export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
export type SubscriptionActor = 'system' | 'payment' | 'user' | 'creator' | 'admin'

type TransitionKey = string
const key = (from: SubscriptionStatus, to: SubscriptionStatus): TransitionKey => from + ':' + to

const allowedActors: Record<TransitionKey, readonly SubscriptionActor[]> = {
  'PENDING:ACTIVE': ['system', 'payment'],
  'ACTIVE:PAST_DUE': ['system', 'payment'],
  'PAST_DUE:ACTIVE': ['system', 'payment'],
  'ACTIVE:CANCELED': ['user', 'creator', 'admin', 'system'],
  'PAST_DUE:CANCELED': ['admin', 'system'],
  'ACTIVE:EXPIRED': ['system'],
  'PAST_DUE:EXPIRED': ['system'],
}

export type SubscriptionState = {
  status: SubscriptionStatus
  version: number
}

export type SubscriptionEvent = {
  to: SubscriptionStatus
  actor: SubscriptionActor
  expectedVersion: number
  idempotencyKey: string
}

export class SubscriptionStateError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export function transitionSubscription(
  current: SubscriptionState,
  event: SubscriptionEvent,
): SubscriptionState {
  if (!Number.isSafeInteger(current.version) || current.version < 1) {
    throw new SubscriptionStateError('INVALID_VERSION')
  }
  if (!Number.isSafeInteger(event.expectedVersion) || event.expectedVersion < 1) {
    throw new SubscriptionStateError('INVALID_EXPECTED_VERSION')
  }
  if (!event.idempotencyKey || event.idempotencyKey.length > 256) {
    throw new SubscriptionStateError('IDEMPOTENCY_KEY_REQUIRED')
  }
  if (event.expectedVersion !== current.version) {
    throw new SubscriptionStateError('VERSION_CONFLICT')
  }

  const actors = allowedActors[key(current.status, event.to)]
  if (!actors || !actors.includes(event.actor)) {
    throw new SubscriptionStateError('INVALID_STATE_TRANSITION')
  }

  return {
    status: event.to,
    version: current.version + 1,
  }
}

export function reconcileSubscriptionEvent(
  current: SubscriptionState,
  event: SubscriptionEvent,
  appliedIdempotencyKeys: ReadonlySet<string> = new Set(),
): { state: SubscriptionState; applied: boolean } {
  if (appliedIdempotencyKeys.has(event.idempotencyKey)) {
    return { state: current, applied: false }
  }

  if (event.expectedVersion < current.version) {
    return { state: current, applied: false }
  }

  return {
    state: transitionSubscription(current, event),
    applied: true,
  }
}

export function isTerminal(status: SubscriptionStatus): boolean {
  return status === 'CANCELED' || status === 'EXPIRED'
}
