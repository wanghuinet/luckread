import { APIError } from 'payload'

export const ACCOUNT_STATES = [
  'PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'FROZEN', 'SUSPENDED', 'BANNED',
  'DELETION_REQUESTED', 'DELETION_PENDING', 'DELETED', 'RESTORED', 'REACTIVATED',
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

const CONTENT_OWN_PERMISSIONS = [
  'content.create.own', 'content.submit_review.own', 'content.update.own', 'content.schedule.own',
  'content.publish.own', 'content.unpublish.own', 'content.archive.own', 'content.delete.own', 'content.restore.own',
]
const ACCOUNT_OPERATOR_PERMISSIONS = ['user.restrict', 'user.freeze', 'user.unfreeze']
const ACCOUNT_ADMIN_PERMISSIONS = ['user.suspend', 'user.ban', 'user.reinstate', 'user.restore', 'user.reactivate']
const ORGANIZATION_PERMISSIONS = ['organization.members.manage', 'organization.scope.read', 'organization.scope.write']
const MODERATION_PERMISSIONS = ['moderation.decide', 'report.review', 'appeal.review']
const SUBSCRIPTION_PERMISSIONS = ['subscription.plan.manage']

const ROLE_PERMISSIONS: Record<string, string[]> = {
  user: CONTENT_OWN_PERMISSIONS,
  verified_user: CONTENT_OWN_PERMISSIONS,
  creator: CONTENT_OWN_PERMISSIONS,
  ip_principal: [...CONTENT_OWN_PERMISSIONS, 'organization.scope.read'],
  mcn_admin: [...CONTENT_OWN_PERMISSIONS, ...ORGANIZATION_PERMISSIONS],
  mcn_editor: [...CONTENT_OWN_PERMISSIONS, 'organization.scope.read', 'organization.scope.write'],
  editor: [...CONTENT_OWN_PERMISSIONS, 'organization.scope.read'],
  operator: [...ACCOUNT_OPERATOR_PERMISSIONS, 'organization.scope.read'],
  moderator: [...MODERATION_PERMISSIONS, ...ACCOUNT_OPERATOR_PERMISSIONS, 'organization.scope.read'],
  admin: [...MODERATION_PERMISSIONS, ...ACCOUNT_OPERATOR_PERMISSIONS, ...ACCOUNT_ADMIN_PERMISSIONS, ...ORGANIZATION_PERMISSIONS, ...SUBSCRIPTION_PERMISSIONS],
  super_admin: [...MODERATION_PERMISSIONS, ...ACCOUNT_OPERATOR_PERMISSIONS, ...ACCOUNT_ADMIN_PERMISSIONS, ...ORGANIZATION_PERMISSIONS, ...SUBSCRIPTION_PERMISSIONS],
}

const WRITE_BLOCKED = new Set<AccountState>(['FROZEN', 'SUSPENDED', 'BANNED', 'DELETION_REQUESTED', 'DELETION_PENDING', 'DELETED'])

export function hasPermission(user: AuthorizationUser | null | undefined, permission: string): boolean {
  if (!user || WRITE_BLOCKED.has(user.accountState ?? 'ACTIVE')) return false
  if (user.permissions?.includes(permission)) return true
  if (user.entitlements?.includes(permission)) return true
  return ROLE_PERMISSIONS[user.role ?? '']?.includes(permission) ?? false
}

export function assertPermission(user: AuthorizationUser | null | undefined, permission: string): void {
  if (!user) throw new APIError('Authentication required', 401)
  if (!hasPermission(user, permission)) throw new APIError(`Permission denied: ${permission}`, 403)
}

export function assertOwnedPermission(args: { user: AuthorizationUser | null | undefined; permission: string; ownerId: string | number }): void {
  assertPermission(args.user, args.permission)
  if (String(args.user!.id) !== String(args.ownerId)) throw new APIError('Resource ownership required', 403)
}
