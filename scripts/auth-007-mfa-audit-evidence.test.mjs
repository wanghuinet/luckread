import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateMfaAuditDelivery,
  REQUIRED_MFA_AUDIT_EVENT_TYPES,
  SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES,
} from './auth-007-mfa-audit-evidence.mjs'

const outbox = REQUIRED_MFA_AUDIT_EVENT_TYPES.map((eventType, i) => ({
  eventId: `evt_core_${String(i).padStart(4, '0')}`,
  eventType,
  status: 'PUBLISHED',
  attempt: 1,
  lastErrorCode: null,
}))
const audit = outbox.map((row) => ({ eventId: row.eventId, action: row.eventType }))

test('accepts core-path delivery only when every published eventId maps to exactly one W06 action', () => {
  const result = evaluateMfaAuditDelivery(outbox, audit)
  assert.equal(result.pass, true)
  assert.equal(result.expectedEventsPresent, true)
  assert.equal(result.allOutboxSettled, true)
  assert.equal(result.persistedExactlyOnce, true)
  assert.equal(result.totalMatchedEventIdCount, REQUIRED_MFA_AUDIT_EVENT_TYPES.length)
  assert.equal(result.allTenEventTypesVerified, false)
  assert.equal(result.scenarioSpecificCoverage.length, 4)
  assert.ok(result.scenarioSpecificCoverage.every((item) => item.observedCount === 0 && !item.verified))
  assert.equal(JSON.stringify(result).includes('evt_core_'), false, 'raw event IDs must not escape reconciliation')
})

test('blocks when a required event has no canonical W06 record', () => {
  const result = evaluateMfaAuditDelivery(outbox, audit.filter((row) => row.eventId !== 'evt_core_0004'))
  assert.equal(result.pass, false)
  assert.equal(result.expectedEventsPresent, false)
  assert.equal(result.totalUnmatchedPublishedEventIdCount, 1)
  assert.equal(result.checks.find((check) => check.eventType === 'auth.mfa.replay_rejected')?.pass, false)
})

test('blocks while any correlated outbox event is pending', () => {
  const rows = outbox.map((row) => row.eventType === 'auth.mfa.recovery_code_consumed'
    ? { ...row, status: 'PENDING' }
    : row)
  const result = evaluateMfaAuditDelivery(rows, audit)
  assert.equal(result.pass, false)
  assert.equal(result.allOutboxSettled, false)
  assert.equal(result.persistedExactlyOnce, false)
})

test('blocks a failed outbox event instead of treating partial delivery as success', () => {
  const rows = outbox.map((row) => row.eventType === 'auth.mfa.factor_disabled'
    ? { ...row, status: 'FAILED' }
    : row)
  const result = evaluateMfaAuditDelivery(rows, audit)
  assert.equal(result.pass, false)
  assert.equal(result.allOutboxSettled, false)
})

test('blocks equal aggregate counts when event IDs differ', () => {
  const differentIds = audit.map((row, i) => ({
    ...row,
    eventId: i === 0 ? 'evt_not_matching_any_outbox_row' : row.eventId,
  }))
  const result = evaluateMfaAuditDelivery(outbox, differentIds)
  assert.equal(outbox.length, differentIds.length)
  assert.equal(result.pass, false)
  assert.equal(result.persistedExactlyOnce, false)
  assert.equal(result.totalUnmatchedPublishedEventIdCount, 1)
  assert.equal(result.totalUnmatchedCanonicalEventIdCount, 1)
})

test('blocks an event ID whose canonical action does not match the outbox event type', () => {
  const wrongAction = audit.map((row, i) => i === 0 ? { ...row, action: 'auth.mfa.factor_disabled' } : row)
  const result = evaluateMfaAuditDelivery(outbox, wrongAction)
  assert.equal(result.pass, false)
  assert.equal(result.totalWrongActionEventIdCount > 0, true)
})

test('blocks duplicate event IDs returned by either read-only query', () => {
  const duplicateOutbox = [...outbox, { ...outbox[0] }]
  const duplicateAudit = [...audit, { ...audit[0] }]
  const duplicateResult = evaluateMfaAuditDelivery(duplicateOutbox, audit)
  const duplicateCanonicalResult = evaluateMfaAuditDelivery(outbox, duplicateAudit)
  assert.equal(duplicateResult.pass, false)
  assert.equal(duplicateResult.totalDuplicateOutboxEventIdCount, 1)
  assert.equal(duplicateCanonicalResult.pass, false)
  assert.equal(duplicateCanonicalResult.totalDuplicateCanonicalEventIdCount, 1)
})

test('reconciles multiple events of the same type by exact eventId rather than count alone', () => {
  const extraOutbox = [...outbox, {
    eventId: 'evt_second_challenge',
    eventType: 'auth.mfa.challenge_succeeded',
    status: 'PUBLISHED',
    attempt: 1,
    lastErrorCode: null,
  }]
  const extraAudit = [...audit, { eventId: 'evt_second_challenge', action: 'auth.mfa.challenge_succeeded' }]
  const result = evaluateMfaAuditDelivery(extraOutbox, extraAudit)
  assert.equal(result.pass, true)
  assert.equal(result.events.find((event) => event.eventType === 'auth.mfa.challenge_succeeded')?.publishedCount, 2)
  assert.equal(result.events.find((event) => event.eventType === 'auth.mfa.challenge_succeeded')?.matchedEventIdCount, 2)
})

test('does not treat empty outbox and canonical result sets as exactly-once delivery', () => {
  const result = evaluateMfaAuditDelivery([], [])
  assert.equal(result.pass, false)
  assert.equal(result.allOutboxSettled, false)
  assert.equal(result.persistedExactlyOnce, false)
})

test('blocks canonical audit rows that have no matching outbox event', () => {
  const rows = [...audit, { eventId: 'evt_orphan', action: 'auth.mfa.locked' }]
  const result = evaluateMfaAuditDelivery(outbox, rows)
  assert.equal(result.pass, false)
  assert.equal(result.persistedExactlyOnce, false)
  assert.equal(result.totalUnmatchedCanonicalEventIdCount, 1)
})

test('reports separate failure and lockout scenario coverage without requiring it in core E2E', () => {
  const extraTypes = SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES.map((eventType, i) => ({
    eventId: `evt_scenario_${String(i).padStart(4, '0')}`,
    eventType,
    status: 'PUBLISHED',
    attempt: 1,
    lastErrorCode: null,
  }))
  const result = evaluateMfaAuditDelivery([...outbox, ...extraTypes], [
    ...audit,
    ...extraTypes.map((row) => ({ eventId: row.eventId, action: row.eventType })),
  ])
  assert.equal(result.pass, true)
  assert.equal(result.allTenEventTypesVerified, true)
  assert.ok(result.scenarioSpecificCoverage.every((item) => item.verified))
  assert.equal(JSON.stringify(result).includes('evt_scenario_'), false)
})
