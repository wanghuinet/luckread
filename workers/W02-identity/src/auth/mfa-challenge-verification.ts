export type MfaChallengeVerificationRecord = {
  value?: unknown
  expiresAt?: unknown
}

/**
 * Better Auth's signed two-factor cookie references a persisted verification
 * record. Accept it only when it contains a non-empty server-side subject and
 * a finite expiration strictly later than the current instant.
 */
export function isUnexpiredMfaChallengeRecord(
  challenge: MfaChallengeVerificationRecord | null | undefined,
  nowMs = Date.now(),
): challenge is MfaChallengeVerificationRecord & { value: string; expiresAt: unknown } {
  if (!challenge || typeof challenge.value !== 'string' || challenge.value.length === 0) return false
  if (!Number.isFinite(nowMs) || nowMs < 0) return false
  const expiresAt = Date.parse(String(challenge.expiresAt))
  return Number.isFinite(expiresAt) && expiresAt > nowMs
}
