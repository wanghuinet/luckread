import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateMfaAuditDelivery, REQUIRED_MFA_AUDIT_EVENT_TYPES } from './auth-007-mfa-audit-evidence.mjs'

const outbox = REQUIRED_MFA_AUDIT_EVENT_TYPES.map((eventType) => ({
  eventType,
  status: 'PUBLISHED',
  count: 1,
}))
const audit = REQUIRED_MFA_AUDIT_EVENT_TYPES.map((action) => ({ action, count: 1 }))

test('accepts published outbox events persisted once by W06', () => {
  const result = evaluateMfaAuditDelivery(outbox, audit)
  assert.equal(result.pass, true)
  assert.equal(result.expectedEventsPresent, true)
  assert.equal(result.allOutboxSettled, true)
  assert.equal(result.persistedExactlyOnce, true)
})

test('blocks when an expected event has no canonical W06 record', () => {
  const result = evaluateMfaAuditDelivery(outbox, audit.filter((row) => row.action !== 'auth.mfa.replay_rejected'))
  assert.equal(result.pass, false)
  assert.equal(result.expectedEventsPresent, false)
  assert.equal(result.checks.find((check) => check.eventType === 'auth.mfa.replay_rejected')?.pass, false)
})

test('blocks while any correlated outbox event is pending', () => {
  const rows = outbox.map((row) => row.eventType === 'auth.mfa.recovery_code_consumed'
    ? { ...row, status: 'PENDING' }
    : row)
  const result = evaluateMfaAuditDelivery(rows, audit)
  assert.equal(result.pass, false)
  assert.equal(result.allOutboxSettled, false)
})

test('blocks a failed outbox event instead of treating partial delivery as success', () => {
  const rows = outbox.map((row) => row.eventType === 'auth.mfa.factor_disabled'
    ? { ...row, status: 'FAILED' }
    : row)
  const result = evaluateMfaAuditDelivery(rows, audit)
  assert.equal(result.pass, false)
  assert.equal(result.allOutboxSettled, false)
})

test('blocks duplicate canonical logical writes when counts exceed published outbox events', () => {
  const rows = audit.map((row) => row.action === 'auth.mfa.factor_disabled'
    ? { ...row, count: 2 }
    : row)
  const result = evaluateMfaAuditDelivery(outbox, rows)
  assert.equal(result.pass, false)
  assert.equal(result.persistedExactlyOnce, false)
})

test('reconciles multiple events of the same type by total count', () => {
  const extraOutbox = [...outbox, { eventType: 'auth.mfa.challenge_succeeded', status: 'PUBLISHED', count: 1 }]
  const extraAudit = [...audit, { action: 'auth.mfa.challenge_succeeded', count: 1 }]
  const result = evaluateMfaAuditDelivery(extraOutbox, extraAudit)
  assert.equal(result.pass, true)
  assert.equal(result.events.find((event) => event.eventType === 'auth.mfa.challenge_succeeded')?.publishedCount, 2)
})

test('does not treat zero published and zero canonical rows as exactly-once delivery', () => {
  const pending = outbox.map((row) => ({ ...row, status: 'PENDING' }))
  const result = evaluateMfaAuditDelivery(pending, [])
  assert.equal(result.pass, false)
  assert.equal(result.allOutboxSettled, false)
  assert.equal(result.persistedExactlyOnce, false)
  assert.equal(
    result.checks.find((check) => check.name === 'canonical_w06_audit_rows_match_published_events')?.pass,
    false,
  )
})

test('blocks canonical audit rows that have no matching outbox event', () => {
  const rows = [...audit, { action: 'auth.mfa.locked', count: 1 }]
  const result = evaluateMfaAuditDelivery(outbox, rows)
  assert.equal(result.pass, false)
  assert.equal(result.persistedExactlyOnce, false)
})
