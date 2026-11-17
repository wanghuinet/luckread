import { activateEmailVerifiedAccount } from '../account/account-state-transition.js'
import {
  ensureVerifiedUserRole,
  resolveGlobalLayer,
  type LayerResolution,
} from '../authz/role-assignment.js'

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

/** Production adapter: retain the established D1-01 transaction boundaries. */
/**
 * @deprecated-next-version
 * Reason: Legacy Cloudflare D1 implementation retained only for isolated unit tests or the explicit schema/test fixture.
 * Replacement: PostgreSQL principal-authority Store in src/neon/principal-authority-postgres.ts.
 * Removal: Next release.
 * Condition: W02 principal resolver and route tests use the Neon Store contract; D1 SQL adapter tests are replaced with PG/in-memory Store contract tests.
 */
export function createD1PrincipalAuthorityStore(db: D1Database): PrincipalAuthorityStore {
  return {
    activateEmailVerifiedAccount: (userId, now) =>
      activateEmailVerifiedAccount(db, userId, now),
    ensureVerifiedUserRole: (userId, now) =>
      ensureVerifiedUserRole(db, userId, now),
    resolveGlobalLayer: (subjectId, accountState, now, includeRoleAssignments) =>
      resolveGlobalLayer(db, subjectId, accountState, now, includeRoleAssignments),
  }
}
