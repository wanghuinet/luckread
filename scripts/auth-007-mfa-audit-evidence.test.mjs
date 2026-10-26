import test from 'node:test'
import assert from 'node:assert/strict'
import {
  evaluateMfaAuditDelivery,
  REQUIRED_MFA_AUDIT_EVENT_TYPES,
  SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES,
} from './auth-007-mfa-audit-evidence.mjs'

const outbox = REQUIRED_MFA_AUDIT_EVENT_TYPES.map((eventType, i) => ({
  eventId: `evt_${i.toString(16).padStart(32, '0')}`,
  eventType,
  resourceId: 'user_qa1',
  idempotencyKey: `mfa-e2e:core:${i}`,
  status: 'PUBLISHED',
  attempt: 1,
  lastErrorCode: null,
}))
const audit = outbox.map((row) => ({
  eventId: row.eventId,
  action: row.eventType,
  targetType: 'User',
  targetId: row.resourceId,
}))

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
  assert.equal(JSON.stringify(result).includes(outbox[0].eventId), false, 'raw event IDs must not escape reconciliation')
})

test('blocks when a required event has no canonical W06 record', () => {
  const result = evaluateMfaAuditDelivery(outbox, audit.filter((row) => row.eventId !== outbox[4].eventId))
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
    eventId: i === 0 ? `evt_${'f'.repeat(32)}` : row.eventId,
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
    eventId: `evt_${'a'.repeat(32)}`,
    eventType: 'auth.mfa.challenge_succeeded',
    resourceId: 'user_qa1',
    idempotencyKey: 'mfa-e2e:extra:second-challenge',
    status: 'PUBLISHED',
    attempt: 1,
    lastErrorCode: null,
  }]
  const extraAudit = [...audit, {
    eventId: `evt_${'a'.repeat(32)}`,
    action: 'auth.mfa.challenge_succeeded',
    targetType: 'User',
    targetId: 'user_qa1',
  }]
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
  const rows = [...audit, {
    eventId: `evt_${'c'.repeat(32)}`,
    action: 'auth.mfa.locked',
    targetType: 'User',
    targetId: 'user_qa1',
  }]
  const result = evaluateMfaAuditDelivery(outbox, rows)
  assert.equal(result.pass, false)
  assert.equal(result.persistedExactlyOnce, false)
  assert.equal(result.totalUnmatchedCanonicalEventIdCount, 1)
})

test('reports separate failure and lockout scenario coverage without requiring it in core E2E', () => {
  const extraTypes = SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES.map((eventType, i) => ({
    eventId: `evt_${(100 + i).toString(16).padStart(32, '0')}`,
    eventType,
    resourceId: 'user_qa1',
    idempotencyKey: `mfa-e2e:scenario:${i}`,
    status: 'PUBLISHED',
    attempt: 1,
    lastErrorCode: null,
  }))
  const result = evaluateMfaAuditDelivery([...outbox, ...extraTypes], [
    ...audit,
    ...extraTypes.map((row) => ({
      eventId: row.eventId,
      action: row.eventType,
      targetType: 'User',
      targetId: row.resourceId,
    })),
  ])
  assert.equal(result.pass, true)
  assert.equal(result.allTenEventTypesVerified, true)
  assert.ok(result.scenarioSpecificCoverage.every((item) => item.verified))
  assert.ok(!JSON.stringify(result).includes(extraTypes[0].eventId))
})

test('blocks a canonical event whose target user differs even when eventId and action match', () => {
  const wrongSubject = audit.map((row, i) => i === 0 ? { ...row, targetId: 'user_other' } : row)
  const result = evaluateMfaAuditDelivery(outbox, wrongSubject)
  assert.equal(result.pass, false)
  assert.equal(result.persistedExactlyOnce, false)
  assert.equal(result.totalWrongSubjectEventIdCount, 1)
})

test('blocks a duplicate outbox idempotency key even when event IDs are unique', () => {
  const duplicateKey = [...outbox, {
    ...outbox[0],
    eventId: `evt_${'b'.repeat(32)}`,
  }]
  const correspondingAudit = [...audit, {
    ...audit[0],
    eventId: `evt_${'b'.repeat(32)}`,
  }]
  const result = evaluateMfaAuditDelivery(duplicateKey, correspondingAudit)
  assert.equal(result.pass, false)
  assert.equal(result.duplicateOutboxIdempotencyKeyCount, 1)
  assert.equal(result.checks.find((check) => check.name === 'outbox_idempotency_keys_are_unique_and_valid')?.pass, false)
})

test('blocks missing or malformed source subject/idempotency key and canonical target type', () => {
  const invalidSource = outbox.map((row, i) => i === 0 ? { ...row, idempotencyKey: '' } : row)
  const invalidTarget = audit.map((row, i) => i === 0 ? { ...row, targetType: 'Session' } : row)
  assert.equal(evaluateMfaAuditDelivery(invalidSource, audit).pass, false)
  assert.equal(evaluateMfaAuditDelivery(outbox, invalidTarget).pass, false)
})


test('rejects malformed event IDs even when source and canonical values agree', () => {
  const malformedOutbox = outbox.map((row, i) => i === 0 ? { ...row, eventId: 'evt_bad' } : row)
  const malformedAudit = audit.map((row, i) => i === 0 ? { ...row, eventId: 'evt_bad' } : row)
  const result = evaluateMfaAuditDelivery(malformedOutbox, malformedAudit)
  assert.equal(result.pass, false)
  assert.equal(result.invalidOutboxRowCount, 1)
  assert.equal(result.invalidCanonicalRowCount, 1)
})
