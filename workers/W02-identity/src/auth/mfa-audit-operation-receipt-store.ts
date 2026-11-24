import type {
  MfaAuditReceiptDrainSummary,
  MfaAuditReceiptEvent,
  MfaAuditReceiptOperationPath,
} from './mfa-audit-receipts.js'

export type MfaAuditOperationReceiptOwnerInput = {
  receiptId: string
  userId: string
  operationPath: MfaAuditReceiptOperationPath
  isChallenge: boolean
}

export type MfaAuditOperationReceiptCreateInput = {
  userId: string
  operationPath: MfaAuditReceiptOperationPath
  isChallenge: boolean
  correlationId?: string | null
  causationId?: string | null
}

export interface MfaAuditOperationReceiptStore {
  assertOwner(input: MfaAuditOperationReceiptOwnerInput): Promise<void>
  create(input: MfaAuditOperationReceiptCreateInput): Promise<string>
  append(receiptId: string, event: MfaAuditReceiptEvent): Promise<void>
  finalize(receiptId: string, events: MfaAuditReceiptEvent[], now?: string): Promise<boolean>
  reconcile(now?: string): Promise<MfaAuditReceiptDrainSummary>
}
