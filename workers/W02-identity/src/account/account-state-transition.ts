export type AccountState =
  | 'UNREGISTERED'
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'RESTRICTED'
  | 'FROZEN'
  | 'SUSPENDED'
  | 'BANNED'
  | 'DELETION_REQUESTED'
  | 'DELETION_PENDING'
  | 'DELETED'
  | 'RESTORED'
  | 'REACTIVATED'

export type AccountActorType = 'user' | 'operator' | 'admin' | 'system' | 'job'

export type AccountStateTransitionInput = {
  userId: string
  to: AccountState
  reason: string
  expectedVersion: number
  actor: { id: string; type: AccountActorType }
  permission?: string | null
  approvalLevel?: string | null
  preconditionSatisfied?: boolean
  now?: string
  correlationId?: string
  causationId?: string
}

export type AccountStateTransitionResult = {
  from: AccountState
  to: AccountState
  accountStateVersion: number
  eventId: string
  journalId: string
}

export type EmailVerifiedActivationResult = {
  activated: boolean
  accountState: AccountState
  accountStateVersion: number
}

export class AccountStateTransitionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'PRECONDITION_FAILED'
      | 'CONFLICT'
      | 'INVALID_STATE'
      | 'JOURNAL_PERSISTENCE_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'AccountStateTransitionError'
  }
}
