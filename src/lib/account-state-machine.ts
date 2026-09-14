import { APIError } from 'payload'

import { assertPermission, type AuthorizationUser } from './authorization'

export const ACCOUNT_STATES = [
  'PENDING_VERIFICATION',
  'ACTIVE',
  'RESTRICTED',
  'FROZEN',
  'SUSPENDED',
  'BANNED',
  'DELETION_REQUESTED',
  'DELETION_PENDING',
  'DELETED',
  'RESTORED',
  'REACTIVATED',
] as const

export type AccountState = (typeof ACCOUNT_STATES)[number]
export type AccountStateActor = 'user' | 'operator' | 'admin' | 'system'

export type AccountStateTransition = {
  from: AccountState
  to: AccountState
  actor: AccountStateActor
  permission: string | null
  precondition?: 'phone_or_email_verified' | 'verification_timeout' | 'cooling_off_started' | 'cooling_off_expired' | 'appeal_approved' | 'restore_window' | 'reauthenticated'
  requiresApproval?: boolean
}

export const ACCOUNT_STATE_TRANSITIONS: readonly AccountStateTransition[] = [
  { from: 'PENDING_VERIFICATION', to: 'ACTIVE', actor: 'user', permission: null, precondition: 'phone_or_email_verified' },
  { from: 'PENDING_VERIFICATION', to: 'DELETED', actor: 'system', permission: 'system.job', precondition: 'verification_timeout' },
  { from: 'ACTIVE', to: 'RESTRICTED', actor: 'operator', permission: 'user.restrict' },
  { from: 'ACTIVE', to: 'FROZEN', actor: 'operator', permission: 'user.freeze' },
  { from: 'ACTIVE', to: 'SUSPENDED', actor: 'admin', permission: 'user.suspend' },
  { from: 'ACTIVE', to: 'BANNED', actor: 'admin', permission: 'user.ban', requiresApproval: true },
  { from: 'ACTIVE', to: 'DELETION_REQUESTED', actor: 'user', permission: null },
  { from: 'RESTRICTED', to: 'ACTIVE', actor: 'operator', permission: 'user.restrict' },
  { from: 'RESTRICTED', to: 'FROZEN', actor: 'operator', permission: 'user.freeze' },
  { from: 'RESTRICTED', to: 'SUSPENDED', actor: 'admin', permission: 'user.suspend' },
  { from: 'RESTRICTED', to: 'BANNED', actor: 'admin', permission: 'user.ban', requiresApproval: true },
  { from: 'FROZEN', to: 'ACTIVE', actor: 'operator', permission: 'user.unfreeze' },
  { from: 'FROZEN', to: 'SUSPENDED', actor: 'admin', permission: 'user.suspend' },
  { from: 'FROZEN', to: 'BANNED', actor: 'admin', permission: 'user.ban', requiresApproval: true },
  { from: 'SUSPENDED', to: 'ACTIVE', actor: 'admin', permission: 'user.reinstate' },
  { from: 'SUSPENDED', to: 'BANNED', actor: 'admin', permission: 'user.ban', requiresApproval: true },
  { from: 'BANNED', to: 'RESTORED', actor: 'admin', permission: 'user.restore', requiresApproval: true, precondition: 'appeal_approved' },
  { from: 'BANNED', to: 'DELETED', actor: 'system', permission: 'system.job' },
  { from: 'DELETION_REQUESTED', to: 'DELETION_PENDING', actor: 'system', permission: 'system.job', precondition: 'cooling_off_started' },
  { from: 'DELETION_REQUESTED', to: 'ACTIVE', actor: 'user', permission: null },
  { from: 'DELETION_PENDING', to: 'DELETED', actor: 'system', permission: 'system.job', precondition: 'cooling_off_expired' },
  { from: 'DELETION_PENDING', to: 'ACTIVE', actor: 'user', permission: null },
  { from: 'DELETED', to: 'REACTIVATED', actor: 'user', permission: 'user.reactivate', precondition: 'restore_window' },
  { from: 'RESTORED', to: 'ACTIVE', actor: 'system', permission: 'system.job', precondition: 'reauthenticated' },
  { from: 'REACTIVATED', to: 'ACTIVE', actor: 'system', permission: 'system.job', precondition: 'reauthenticated' },
]

export const ACCOUNT_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export function resolveAccountStateTransition(from: AccountState, to: AccountState): AccountStateTransition {
  const transition = ACCOUNT_STATE_TRANSITIONS.find((candidate) => candidate.from === from && candidate.to === to)
  if (!transition) throw new APIError(`Forbidden account state transition: ${from} -> ${to}`, 409)
  return transition
}

export function assertAccountStateActor(args: {
  transition: AccountStateTransition
  user: AuthorizationUser | null
  targetUserId: string | number
}): void {
  const { transition, user, targetUserId } = args
  if (!user) throw new APIError('Authentication required', 401)
  if (transition.actor === 'system') throw new APIError('System-only account state transition', 403)
  if (transition.actor === 'user') {
    if (String(user.id) !== String(targetUserId)) throw new APIError('Account self-service ownership required', 403)
    if (transition.permission) assertPermission(user, transition.permission)
    return
  }
  if (!transition.permission) throw new APIError('Account state transition permission is undefined', 500)
  assertPermission(user, transition.permission)
}

export function assertAccountRestoreWindow(deletedAt: unknown, now = new Date()): void {
  const deletedTimestamp = deletedAt instanceof Date ? deletedAt.getTime() : typeof deletedAt === 'string' ? Date.parse(deletedAt) : Number.NaN
  if (Number.isNaN(deletedTimestamp) || deletedTimestamp + ACCOUNT_RESTORE_WINDOW_MS < now.getTime()) {
    throw new APIError('Account reactivation window has expired', 409)
  }
}
