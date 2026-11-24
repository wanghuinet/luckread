import type { AccountState, AccountStateTransitionResult } from './account-state-transition.js'

/** Authenticated account-state command after the W01 -> W02 internal boundary. */
export type AccountStateTransitionCommand = {
  subjectId: string
  targetUserId: string
  to: AccountState
  reason: string
  expectedVersion: number
  correlationId?: string
  causationId?: string
}

export interface AccountStateTransitionStore {
  transition(command: AccountStateTransitionCommand): Promise<AccountStateTransitionResult>
}
