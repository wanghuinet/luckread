export type MfaEnrollmentConfirmState = {
  userEnabled: boolean
  confirmationKeyHash: string | null
  confirmationRequestHash: string | null
  factorVerified: boolean | null
}

export type MfaEnrollmentConfirmStore = {
  read(userId: string): Promise<MfaEnrollmentConfirmState | null>
  persistConfirmation(input: {
    userId: string
    keyHash: string
    requestHash: string
  }): Promise<boolean>
}
