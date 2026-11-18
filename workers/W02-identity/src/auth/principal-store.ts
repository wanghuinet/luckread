import type { LayerResolution } from '../authz/role-assignment.js'

export type PrincipalAuthorityActivation = {
  accountState: string
  accountStateVersion: number
}

/**
 * Persistence boundary for the canonical Better Auth principal resolver.
 * Better Auth remains the identity/session authority; this store owns the
 * account-lifecycle repair and effective W02 authorization facts.
 */
export interface PrincipalAuthorityStore {
  activateEmailVerifiedAccount(
    userId: string,
    now: string,
  ): Promise<PrincipalAuthorityActivation>
  ensureVerifiedUserRole(userId: string, now: string): Promise<void>
  resolveGlobalLayer(
    subjectId: string,
    accountState: string,
    now: string,
    includeRoleAssignments: boolean,
  ): Promise<LayerResolution>
}
