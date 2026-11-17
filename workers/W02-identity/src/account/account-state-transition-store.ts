import {
  applyAccountStateTransition,
  authorizeAccountStateTransition,
  type AccountState,
  type AccountStateTransitionResult,
} from './account-state-transition.js'

/**
 * Authenticated account-state command after the W01 -> W02 internal boundary.
 * The storage adapter, not the request, derives actor, permission and approval.
 */
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

/**
 * Production adapter. Preserve the full existing D1 authorization and
 * transition behavior, including self-service, system/job, and approval
 * contract checks. PostgreSQL's narrower moderator/admin adapter is separate.
 */
/**
 * @deprecated-next-version
 * Reason: Legacy Cloudflare D1 implementation retained only for isolated unit tests or the explicit schema/test fixture.
 * Replacement: PostgreSQL account-state transition Store in src/neon/account-state-transition-store-postgres.ts.
 * Removal: Next release.
 * Condition: Account transition contract tests use PostgreSQL/in-memory Store fixtures and D1 batch compatibility is no longer needed.
 */
export function createD1AccountStateTransitionStore(
  db: D1Database,
): AccountStateTransitionStore {
  return {
    async transition(command) {
      const authorization = await authorizeAccountStateTransition(db, {
        subjectId: command.subjectId,
        targetUserId: command.targetUserId,
        to: command.to,
      })

      return applyAccountStateTransition(db, {
        userId: command.targetUserId,
        to: command.to,
        reason: command.reason,
        expectedVersion: command.expectedVersion,
        actor: authorization.actor,
        permission: authorization.permission,
        approvalLevel: authorization.approvalLevel,
        correlationId: command.correlationId,
        causationId: command.causationId,
      })
    },
  }
}
