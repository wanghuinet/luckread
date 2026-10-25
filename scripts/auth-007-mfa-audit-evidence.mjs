export const REQUIRED_MFA_AUDIT_EVENT_TYPES = Object.freeze([
  'auth.mfa.enrollment_started',
  'auth.mfa.enrollment_verified',
  'auth.mfa.challenge_succeeded',
  'auth.mfa.recovery_code_consumed',
  'auth.mfa.replay_rejected',
  'auth.mfa.factor_disabled',
])

const safeCount = (value) => {
  const count = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(count) && count >= 0 ? count : 0
}

const countRows = (rows, field, value) => rows
  .filter((row) => row && row[field] === value)
  .reduce((sum, row) => sum + safeCount(row.count), 0)

/**
 * Reconcile read-only D1 query aggregates without exposing user IDs or payloads.
 * A PASS requires expected events to be published, each published event to have
 * exactly one canonical W06 AuditEvent row, and no matching outbox item to be
 * pending or failed. D1/W06 duplicate delivery therefore cannot inflate counts.
 */
export function evaluateMfaAuditDelivery(outboxRows, canonicalAuditRows) {
  const outbox = Array.isArray(outboxRows) ? outboxRows : []
  const audit = Array.isArray(canonicalAuditRows) ? canonicalAuditRows : []
  const eventTypes = [...new Set([
    ...outbox.map((row) => row?.eventType),
    ...audit.map((row) => row?.action),
  ].filter((value) => typeof value === 'string'))].sort()

  const events = eventTypes.map((eventType) => {
    const totalCount = countRows(outbox, 'eventType', eventType)
    const publishedCount = outbox
      .filter((row) => row?.eventType === eventType && row?.status === 'PUBLISHED')
      .reduce((sum, row) => sum + safeCount(row.count), 0)
    const pendingCount = outbox
      .filter((row) => row?.eventType === eventType && row?.status === 'PENDING')
      .reduce((sum, row) => sum + safeCount(row.count), 0)
    const failedCount = outbox
      .filter((row) => row?.eventType === eventType && row?.status === 'FAILED')
      .reduce((sum, row) => sum + safeCount(row.count), 0)
    const canonicalAuditCount = countRows(audit, 'action', eventType)
    return {
      eventType,
      totalCount,
      publishedCount,
      pendingCount,
      failedCount,
      canonicalAuditCount,
      outboxSettled: totalCount > 0 && publishedCount === totalCount && pendingCount === 0 && failedCount === 0,
      persistedExactlyOnce: canonicalAuditCount === publishedCount,
    }
  })

  const requiredChecks = REQUIRED_MFA_AUDIT_EVENT_TYPES.map((eventType) => {
    const found = events.find((event) => event.eventType === eventType)
    return {
      name: 'required_event_' + eventType,
      eventType,
      pass: Boolean(found && found.publishedCount > 0 && found.canonicalAuditCount > 0),
    }
  })
  const allOutboxSettled = events.length > 0 && events.every((event) => event.outboxSettled)
  const persistedExactlyOnce = events.length > 0 && events.every((event) => event.persistedExactlyOnce)
  const expectedEventsPresent = requiredChecks.every((check) => check.pass)
  const checks = [
    ...requiredChecks,
    { name: 'all_correlated_outbox_events_published', pass: allOutboxSettled },
    { name: 'canonical_w06_audit_rows_match_published_events', pass: persistedExactlyOnce },
  ]
  return {
    pass: checks.every((check) => check.pass),
    expectedEventsPresent,
    allOutboxSettled,
    persistedExactlyOnce,
    correlatedEventTypes: events.length,
    checks,
    events,
  }
}
