export type SessionListCursor = {
  createdAt: string
  sessionId: string
}

export type SessionListStoreInput = {
  userId: string
  now: string
  limit: number
  cursor: SessionListCursor | null
}

export type SessionListStoreRow = {
  sessionId: string
  createdAt: string
  expiresAt: string
}

export type SessionListStoreResult = {
  permissionGranted: boolean
  rows: SessionListStoreRow[]
}

/**
 * Read-only persistence boundary for AUTH-010 current-user session listing.
 * The handler authenticates the caller, checks rate limits and applies its
 * response/cursor policy. Stores re-check the effective W02 base-user role
 * and return only non-secret session metadata for the supplied subject.
 */
export interface SessionListStore {
  list(input: SessionListStoreInput): Promise<SessionListStoreResult>
}
