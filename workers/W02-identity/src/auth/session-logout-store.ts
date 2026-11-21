export type SessionLogoutStoreInput = {
  userId: string
  sessionId: string
  now: string
  correlationId?: string | null
  causationId?: string | null
}

export type SessionLogoutStoreResult =
  | { status: 'REVOKED' }
  | { status: 'NOT_FOUND_OR_NOT_OWNED' }

/**
 * Deletes only the authenticated caller's current session and records its
 * durable USER_LOGOUT audit intent within the same storage transaction.
 */
export interface SessionLogoutStore {
  logout(input: SessionLogoutStoreInput): Promise<SessionLogoutStoreResult>
}
