import type { MfaAuditEvent } from './mfa-audit-events.js'

export type MfaEnrollmentStartReservationInput = {
  userId: string
  keyHash: string
  event: MfaAuditEvent
}

export interface MfaEnrollmentStartStore {
  reserve(input: MfaEnrollmentStartReservationInput): Promise<boolean>
  recordFailure(event: MfaAuditEvent): Promise<void>
  releaseReservationIfNoFactor(userId: string, keyHash: string): Promise<void>
}
