import {
  appendMfaAuditOperationReceiptEvent,
  assertMfaAuditOperationReceiptOwner,
  createMfaAuditOperationReceipt,
  finalizeMfaAuditOperationReceipt,
  reconcileMfaAuditOperationReceipts,
  type MfaAuditReceiptDrainSummary,
  type MfaAuditReceiptEvent,
  type MfaAuditReceiptOperationPath,
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

/** D1 remains the production-default durable MFA receipt implementation. */
export function createD1MfaAuditOperationReceiptStore(db: D1Database): MfaAuditOperationReceiptStore {
  return {
    assertOwner: (input) => assertMfaAuditOperationReceiptOwner(db, input),
    create: (input) => createMfaAuditOperationReceipt(db, input),
    append: (receiptId, event) => appendMfaAuditOperationReceiptEvent(db, receiptId, event),
    finalize: (receiptId, events, now) => now === undefined
      ? finalizeMfaAuditOperationReceipt(db, receiptId, events)
      : finalizeMfaAuditOperationReceipt(db, receiptId, events, now),
    reconcile: (now) => now === undefined
      ? reconcileMfaAuditOperationReceipts(db)
      : reconcileMfaAuditOperationReceipts(db, now),
  }
}
