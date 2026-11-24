export type MfaFactorVerificationMaterial = {
  /** Better Auth encrypted factor secret; never plaintext. */
  encryptedSecret: string
  /** PostgreSQL TIMESTAMPTZ is returned as Date; string is allowed for test fixtures. */
  lockedUntil: Date | string | null
}

/**
 * W02 MFA verification persistence port.
 * Implementations must preserve W02 account-state authority, encrypted-secret-only
 * reads, and atomic strictly increasing TOTP time-step reservation.
 */
export type MfaFactorStateStore = {
  isActiveSubject(userId: string): Promise<boolean>
  readVerificationMaterial(userId: string): Promise<MfaFactorVerificationMaterial | null>
  consumeTotpTimeStep(userId: string, timeStep: number): Promise<boolean>
}
