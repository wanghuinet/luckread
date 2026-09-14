import { APIError } from 'payload'

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

export type AuthorizationUser = {
  id: string | number
  role?: string | null
  accountState?: AccountState | null
  permissions?: string[] | null
  entitlements?: string[] | null
  organizationScopes?: string[] | null
}

const ROLE_PERMISSIONS: Record<string, string[]> = {
  user: ['content.submit_review.own', 'content.update.own', 'content.schedule.own', 'content.publish.own', 'content.unpublish.own', 'content.archive.own', 'content.delete.own', 'content.restore.own'],
  verified_user: ['content.submit_review.own', 'content.update.own', 'content.schedule.own', 'content.publish.own', 'content.unpublish.own', 'content.archive.own', 'content.delete.own', 'content.restore.own'],
  creator: ['content.submit_review.own', 'content.update.own', 'content.schedule.own', 'content.publish.own', 'content.unpublish.own', 'content.archive.own', 'content.delete.own', 'content.restore.own'],
  moderator: ['moderation.decide'],
  admin: ['moderation.decide'],
  super_admin: ['moderation.decide'],
}

const WRITE_BLOCKED = new Set<AccountState>(['FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_REQUESTED', 'DELETION_PENDING', 'DELETED'])

export function hasPermission(user: AuthorizationUser | null | undefined, permission: string): boolean {
  if (!user) return false
  if (WRITE_BLOCKED.has(user.accountState ?? 'ACTIVE')) return false
  if (user.permissions?.includes(permission)) return true
  if (user.entitlements?.includes(permission)) return true
  return ROLE_PERMISSIONS[user.role ?? '']?.includes(permission) ?? false
}

export function assertPermission(user: AuthorizationUser | null | undefined, permission: string): void {
  if (!user) throw new APIError('Authentication required', 401)
  if (!hasPermission(user, permission)) throw new APIError(`Permission denied: ${permission}`, 403)
}

export function assertOwnedPermission(args: {
  user: AuthorizationUser | null | undefined
  permission: string
  ownerId: string | number
}): void {
  assertPermission(args.user, args.permission)
  if (String(args.user!.id) !== String(args.ownerId)) {
    throw new APIError('Resource ownership required', 403)
  }
}
