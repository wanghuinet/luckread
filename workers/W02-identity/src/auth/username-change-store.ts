export type UsernameChangeContext = {
  username: string | null
  accountState: string
  usernameVersion: number
  lastChangedAt: string | null
  replayKeyHash: string | null
  replayUsername: string | null
  replayFingerprint: string | null
  replayChangedAt: string | null
  replayExpiresAt: string | null
}

export type UsernameChangeState = Pick<
  UsernameChangeContext,
  'username' | 'accountState' | 'usernameVersion' | 'lastChangedAt'
>

export type UsernameChangeCommand = {
  userId: string
  currentUsername: string
  nextUsername: string
  currentUsernameNormalized: string
  nextUsernameNormalized: string
  expectedVersion: number
  nowIso: string
  reservationExpiresAt: string
  idempotencyKeyHash: string
  requestFingerprint: string
  idempotencyExpiresAt: string
}

export type UsernameChangeWriteResult = {
  updated: number
  saved: number
}

/**
 * Persistence seam for W02 username changes.
 *
 * The adapter must atomically update Better Auth's current username and the
 * compact W02 lease/idempotency row. Public policy, caller authentication,
 * rate limiting and response semantics remain in username-change.ts.
 */
export type UsernameChangeStore = {
  loadContext(
    userId: string,
    idempotencyKeyHash: string,
    nowIso: string,
  ): Promise<UsernameChangeContext | null>
  loadState(userId: string): Promise<UsernameChangeState | null>
  applyChange(command: UsernameChangeCommand): Promise<UsernameChangeWriteResult>
}
