import { describe, expect, it } from 'vitest'

import { createD1MfaAuditOperationReceiptStore } from './mfa-audit-operation-receipt-store.js'

describe('W02 MFA operation receipt store', () => {
  it('exposes the D1 Cron reconciliation through the shared store contract', async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = []
    const db = {
      prepare(sql: string) {
        const call = { sql, values: [] as unknown[] }
        statements.push(call)
        return {
          bind(...values: unknown[]) {
            call.values = values
            return this
          },
          async run() {
            return { success: true, meta: { changes: 0 } }
          },
          async all() {
            return { success: true, results: [] }
          },
        }
      },
    } as unknown as D1Database

    const store = createD1MfaAuditOperationReceiptStore(db)
    await expect(store.reconcile('2026-11-10T12:00:00.000Z')).resolves.toEqual({
      selected: 0,
      emitted: 0,
      failed: 0,
      unknown: 0,
    })

    expect(statements.map((statement) => statement.sql)).toEqual([
      expect.stringContaining('UPDATE auth_007_mfa_operation_receipts'),
      expect.stringContaining('SELECT receipt_id AS receiptId'),
    ])
    expect(statements[0]?.values).toEqual([
      'UNKNOWN',
      'OUTCOME_NOT_FINALIZED',
      'STARTED',
      '2026-11-10T11:55:00.000Z',
    ])
    expect(statements[1]?.values).toEqual(['READY', '2026-11-10T12:00:00.000Z', 10])
  })
})
