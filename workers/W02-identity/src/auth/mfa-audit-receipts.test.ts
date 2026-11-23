import { describe, expect, it } from 'vitest'
import {
  mergeMfaAuditReceiptPlan,
  parseMfaAuditReceiptPlan,
} from './mfa-audit-receipts.js'

const receiptId = 'mfaop_0123456789abcdef0123456789abcdef'
const baseEvent = {
  eventType: 'auth.mfa.enrollment_verified' as const,
  operationId: 'authMfaEnrollmentConfirm' as const,
  eventId: 'evt_0123456789abcdef0123456789abcdef',
  result: 'succeeded' as const,
  reasonCode: 'TOTP_ENROLLMENT_VERIFIED',
  factorState: 'ENABLED' as const,
  idempotencyKey: 'mfa-operation:' + receiptId + ':auth.mfa.enrollment_verified',
  occurredAt: '2026-11-23T12:00:00.000Z',
}

describe('MFA audit receipt plan domain helpers', () => {
  it('parses an empty receipt plan without a database adapter', () => {
    expect(parseMfaAuditReceiptPlan(null)).toEqual([])
  })

  it('merges a bounded event plan and preserves first durable identity on retry', () => {
    const first = mergeMfaAuditReceiptPlan(receiptId, [], [baseEvent], '2026-11-23T12:00:00.000Z')
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      eventId: baseEvent.eventId,
      eventType: baseEvent.eventType,
      idempotencyKey: baseEvent.idempotencyKey,
    })

    const retry = mergeMfaAuditReceiptPlan(receiptId, first, [{
      ...baseEvent,
      eventId: 'evt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      occurredAt: '2026-11-23T12:01:00.000Z',
    }], '2026-11-23T12:01:00.000Z')
    expect(retry).toEqual(first)
  })

  it('rejects conflicting intent for an already reserved idempotency key', () => {
    const first = mergeMfaAuditReceiptPlan(receiptId, [], [baseEvent], '2026-11-23T12:00:00.000Z')
    expect(() => mergeMfaAuditReceiptPlan(receiptId, first, [{
      ...baseEvent,
      result: 'failed',
      reasonCode: 'ENROLLMENT_CONFIRMATION_REJECTED',
    }], '2026-11-23T12:02:00.000Z')).toThrow('MFA_AUDIT_EVENT_IDEMPOTENCY_CONFLICT')
  })

  it('rejects malformed serialized plans and more than four events', () => {
    expect(() => parseMfaAuditReceiptPlan('{')).toThrow('INVALID_MFA_AUDIT_RECEIPT_PLAN')
    const events = Array.from({ length: 5 }, (_, index) => ({
      ...baseEvent,
      eventId: 'evt_' + String(index).padStart(32, '0'),
      idempotencyKey: 'mfa-operation:' + receiptId + ':' + index,
    }))
    expect(() => mergeMfaAuditReceiptPlan(receiptId, [], events, '2026-11-23T12:00:00.000Z'))
      .toThrow('MFA_AUDIT_RECEIPT_PLAN_LIMIT_EXCEEDED')
  })
})
