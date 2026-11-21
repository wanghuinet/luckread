export type SessionRevocationStoreInput = {
  userId: string
  sessionId: string
  now: string
  correlationId?: string | null
  causationId?: string | null
}

export type SessionRevocationStoreResult =
  | { status: 'REVOKED' }
  | { status: 'NOT_FOUND_OR_NOT_OWNED' }
  | { status: 'PERMISSION_DENIED' }

/**
 * Persistence boundary for AUTH-010 self-scope session revocation.
 * The handler authenticates the current session, enforces rate limits and
 * protects that current session. The Store rechecks effective user authority,
 * ownership and atomically commits native-session deletion with audit intent.
 */
export interface SessionRevocationStore {
  revoke(input: SessionRevocationStoreInput): Promise<SessionRevocationStoreResult>
}
