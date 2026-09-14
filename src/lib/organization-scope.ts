import { APIError } from 'payload'

import type { AuthorizationUser } from './authorization'

export type OrganizationScope = {
  organizationId: string | number
  scopes: readonly string[]
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
}

export function canAccessOrganizationScope(args: {
  user: AuthorizationUser | null
  organizationId: string | number
  requiredScope: string
  memberships: readonly OrganizationScope[]
}): boolean {
  const { user, organizationId, requiredScope, memberships } = args
  if (!user) return false

  return memberships.some((membership) =>
    membership.status === 'ACTIVE' &&
    String(membership.organizationId) === String(organizationId) &&
    (membership.scopes.includes('*') || membership.scopes.includes(requiredScope)),
  )
}

export function assertOrganizationScope(args: {
  user: AuthorizationUser | null
  organizationId: string | number
  requiredScope: string
  memberships: readonly OrganizationScope[]
}): void {
  if (!canAccessOrganizationScope(args)) {
    throw new APIError('Organization scope permission denied', 403)
  }
}
