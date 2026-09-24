import accountStateMachine from '../../../../contracts/state-machines/account.json'

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
  actor: {
    id: string
    type: AccountActorType
  }
  permission?: string | null
  approvalLevel?: string | null
  preconditionSatisfied?: boolean
  now?: string
}

export type AccountStateTransitionResult = {
  from: AccountState
  to: AccountState
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
      | 'INVALID_STATE',
    message: string,
  ) {
    super(message)
  }
}

type TransitionRule = {
  from: AccountState
  to: AccountState
  actor: AccountActorType
  permission: string | null
  precondition?: string
  requiresApproval?: boolean | string
}

const transitionRules = accountStateMachine['x-transitions'] as TransitionRule[]

function assertInput(input: AccountStateTransitionInput): void {
  if (!input || typeof input.userId !== 'string' || input.userId.length === 0) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'userId is required')
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'expectedVersion must be a positive integer')
  }
  if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 2048) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'reason must be 1-2048 characters')
  }
  if (!input.actor || typeof input.actor.id !== 'string' || input.actor.id.length === 0) {
    throw new AccountStateTransitionError('INVALID_INPUT', 'actor id is required')
  }
}

function findTransition(from: AccountState, to: AccountState): TransitionRule {
  const transition = transitionRules.find((rule) => rule.from === from && rule.to === to)
  if (!transition) {
    throw new AccountStateTransitionError(
      'INVALID_STATE',
      'transition ' + from + ' -> ' + to + ' is not permitted by the canonical account state machine',
    )
  }
  return transition
}

function assertActor(rule: TransitionRule, input: AccountStateTransitionInput): void {
  if (rule.actor === 'user') {
    if (input.actor.type !== 'user' || input.actor.id !== input.userId) {
      throw new AccountStateTransitionError('FORBIDDEN', 'user transition requires the target user as actor')
    }
  } else if (rule.actor === 'system') {
    if (input.actor.type !== 'system' && input.actor.type !== 'job') {
      throw new AccountStateTransitionError('FORBIDDEN', 'system transition requires a system/job actor')
    }
  } else if (input.actor.type !== rule.actor) {
    throw new AccountStateTransitionError('FORBIDDEN', 'transition requires ' + rule.actor + ' actor')
  }

  if (rule.permission !== (input.permission ?? null)) {
    throw new AccountStateTransitionError('FORBIDDEN', 'required transition permission is missing or mismatched')
  }
}

function assertRequirements(rule: TransitionRule, input: AccountStateTransitionInput): void {
  if (rule.precondition && input.preconditionSatisfied !== true) {
    throw new AccountStateTransitionError('PRECONDITION_FAILED', 'precondition failed: ' + rule.precondition)
  }

  if (rule.requiresApproval) {
    const requiredLevel = rule.requiresApproval === true ? 'L7' : rule.requiresApproval
    if (input.approvalLevel !== requiredLevel) {
      throw new AccountStateTransitionError('FORBIDDEN', 'approval level ' + requiredLevel + ' is required')
    }
  }
}

export async function applyAccountStateTransition(
  db: D1Database,
  input: AccountStateTransitionInput,
): Promise<AccountStateTransitionResult> {
  assertInput(input)

  const current = await db
    .prepare(
      'SELECT account_state AS accountState, account_state_version AS accountStateVersion FROM users WHERE id = ? LIMIT 1',
    )
    .bind(input.userId)
    .first<{ accountState: AccountState; accountStateVersion: number }>()

  if (!current) {
    throw new AccountStateTransitionError('NOT_FOUND', 'user account not found')
  }

  const from = current.accountState
  const rule = findTransition(from, input.to)

  if (current.accountStateVersion !== input.expectedVersion) {
    throw new AccountStateTransitionError('CONFLICT', 'account state version does not match If-Match')
  }

  assertActor(rule, input)
  assertRequirements(rule, input)

  const now = input.now ?? new Date().toISOString()
  const result = await db
    .prepare(
      'UPDATE users SET account_state = ?, account_state_version = account_state_version + 1, updated_at = ? WHERE id = ? AND account_state = ? AND account_state_version = ?',
    )
    .bind(input.to, now, input.userId, from, input.expectedVersion)
    .run()

  if (result.meta?.changes !== 1) {
    throw new AccountStateTransitionError(
      'CONFLICT',
      'account state changed concurrently; no transition was committed',
    )
  }

  return {
    from,
    to: input.to,
    accountStateVersion: input.expectedVersion + 1,
  }
}