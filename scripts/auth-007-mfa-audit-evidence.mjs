export const REQUIRED_MFA_AUDIT_EVENT_TYPES = Object.freeze([
  'auth.mfa.enrollment_started',
  'auth.mfa.enrollment_verified',
  'auth.mfa.challenge_succeeded',
  'auth.mfa.recovery_code_consumed',
  'auth.mfa.replay_rejected',
  'auth.mfa.factor_disabled',
])

// These four event types require separate negative/administrative scenarios.
// They are reported explicitly but are not falsely required to occur in the
// same core-success E2E correlation scope.
export const SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES = Object.freeze([
  'auth.mfa.enrollment_failed',
  'auth.mfa.challenge_failed',
  'auth.mfa.recovery_codes_rotated',
  'auth.mfa.locked',
])

const allKnownEventTypes = new Set([
  ...REQUIRED_MFA_AUDIT_EVENT_TYPES,
  ...SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES,
])

const safeEventId = (value) =>
  typeof value === 'string' &&
  /^evt_[a-f0-9]{32}$/.test(value)

function summarizeEventType(eventType, outboxRows, canonicalRows, idReconciliation) {
  const rows = outboxRows.filter((row) => row?.eventType === eventType)
  const totalCount = rows.length
  const publishedRows = rows.filter((row) => row.status === 'PUBLISHED')
  const pendingCount = rows.filter((row) => row.status === 'PENDING').length
  const failedCount = rows.filter((row) => row.status === 'FAILED').length
  const canonicalAuditCount = canonicalRows.filter((row) => row?.action === eventType).length
  const publishedCount = publishedRows.length
  const idFacts = idReconciliation.byEventType[eventType] ?? {
    matchedEventIdCount: 0,
    unmatchedPublishedEventIdCount: 0,
    unmatchedCanonicalEventIdCount: 0,
    duplicateOutboxEventIdCount: 0,
    duplicateCanonicalEventIdCount: 0,
    wrongActionEventIdCount: 0,
    wrongSubjectEventIdCount: 0,
    duplicateOutboxIdempotencyKeyCount: 0,
  }
  const idsMatch = idFacts.unmatchedPublishedEventIdCount === 0 &&
    idFacts.unmatchedCanonicalEventIdCount === 0 &&
    idFacts.duplicateOutboxEventIdCount === 0 &&
    idFacts.duplicateCanonicalEventIdCount === 0 &&
    idFacts.wrongActionEventIdCount === 0 &&
    idFacts.wrongSubjectEventIdCount === 0 &&
    idFacts.duplicateOutboxIdempotencyKeyCount === 0 &&
    idReconciliation.duplicateOutboxIdempotencyKeyCount === 0 &&
    idReconciliation.invalidIdempotencyKeyCount === 0

  return {
    eventType,
    totalCount,
    publishedCount,
    pendingCount,
    failedCount,
    canonicalAuditCount,
    ...idFacts,
    outboxSettled: totalCount > 0 && publishedCount === totalCount && pendingCount === 0 && failedCount === 0,
    persistedExactlyOnce: publishedCount > 0 && idsMatch &&
      idFacts.matchedEventIdCount === publishedCount &&
      canonicalAuditCount === publishedCount,
  }
}

const safeResourceId = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)

const safeIdempotencyKey = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9._:-]{1,255}$/.test(value)

function reconcileEventIds(outboxRows, canonicalRows) {
  const outboxIdCounts = new Map()
  const canonicalIdCounts = new Map()
  const outboxTypeById = new Map()
  const canonicalTypeById = new Map()
  const canonicalSubjectById = new Map()
  const outboxKeyCounts = new Map()

  const invalidOutboxRows = outboxRows.filter((row) =>
    !row || !safeEventId(row.eventId) ||
    typeof row.eventType !== 'string' || !allKnownEventTypes.has(row.eventType) ||
    !['PENDING', 'PUBLISHED', 'FAILED'].includes(row.status) ||
    !safeResourceId(row.resourceId) ||
    !safeIdempotencyKey(row.idempotencyKey))
  const invalidCanonicalRows = canonicalRows.filter((row) =>
    !row || !safeEventId(row.eventId) ||
    typeof row.action !== 'string' || !allKnownEventTypes.has(row.action) ||
    row.targetType !== 'User' || !safeResourceId(row.targetId))

  for (const row of outboxRows) {
    if (!row || !safeEventId(row.eventId) || typeof row.eventType !== 'string') continue
    outboxIdCounts.set(row.eventId, (outboxIdCounts.get(row.eventId) ?? 0) + 1)
    if (!outboxTypeById.has(row.eventId)) outboxTypeById.set(row.eventId, row.eventType)
    if (safeIdempotencyKey(row.idempotencyKey)) {
      outboxKeyCounts.set(row.idempotencyKey, (outboxKeyCounts.get(row.idempotencyKey) ?? 0) + 1)
    }
  }
  for (const row of canonicalRows) {
    if (!row || !safeEventId(row.eventId) || typeof row.action !== 'string') continue
    canonicalIdCounts.set(row.eventId, (canonicalIdCounts.get(row.eventId) ?? 0) + 1)
    if (!canonicalTypeById.has(row.eventId)) canonicalTypeById.set(row.eventId, row.action)
    if (safeResourceId(row.targetId) && !canonicalSubjectById.has(row.eventId)) {
      canonicalSubjectById.set(row.eventId, row.targetId)
    }
  }

  const duplicateOutboxIdempotencyKeyCount = new Set(
    [...outboxKeyCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  ).size
  const invalidIdempotencyKeyCount = outboxRows.filter((row) =>
    !row || !safeIdempotencyKey(row.idempotencyKey)).length

  const byEventType = {}
  for (const eventType of allKnownEventTypes) {
    const publishedRows = outboxRows.filter((row) => row?.eventType === eventType && row.status === 'PUBLISHED')
    const canonicalRowsForType = canonicalRows.filter((row) => row?.action === eventType)
    const matches = (row) =>
      outboxIdCounts.get(row.eventId) === 1 &&
      canonicalIdCounts.get(row.eventId) === 1 &&
      canonicalTypeById.get(row.eventId) === eventType &&
      outboxTypeById.get(row.eventId) === eventType &&
      safeResourceId(row.resourceId) &&
      canonicalSubjectById.get(row.eventId) === row.resourceId &&
      canonicalRows.find((canonicalRow) => canonicalRow?.eventId === row.eventId)?.targetType === 'User' &&
      safeIdempotencyKey(row.idempotencyKey) &&
      outboxKeyCounts.get(row.idempotencyKey) === 1

    const matchedEventIdCount = publishedRows.filter(matches).length
    const unmatchedPublishedEventIdCount = publishedRows.filter((row) => !matches(row)).length
    const unmatchedCanonicalEventIdCount = canonicalRowsForType.filter((row) => {
      const source = outboxRows.find((outboxRow) => outboxRow?.eventId === row.eventId)
      return canonicalIdCounts.get(row.eventId) !== 1 ||
        outboxIdCounts.get(row.eventId) !== 1 ||
        outboxTypeById.get(row.eventId) !== eventType ||
        canonicalTypeById.get(row.eventId) !== eventType ||
        !source || source.status !== 'PUBLISHED' ||
        !safeResourceId(row.targetId) ||
        row.targetType !== 'User' ||
        row.targetId !== source.resourceId ||
        !safeIdempotencyKey(source.idempotencyKey) ||
        outboxKeyCounts.get(source.idempotencyKey) !== 1
    }).length
    const duplicateOutboxEventIdCount = new Set(outboxRows
      .filter((row) =>
        row?.eventType === eventType && safeEventId(row.eventId) && outboxIdCounts.get(row.eventId) > 1
      )
      .map((row) => row.eventId)).size
    const duplicateCanonicalEventIdCount = new Set(canonicalRows
      .filter((row) =>
        row?.action === eventType && safeEventId(row.eventId) && canonicalIdCounts.get(row.eventId) > 1
      )
      .map((row) => row.eventId)).size
    const wrongActionEventIdCount = new Set([
      ...publishedRows.filter((row) =>
        canonicalIdCounts.has(row.eventId) && canonicalTypeById.get(row.eventId) !== eventType
      ).map((row) => row.eventId),
      ...canonicalRowsForType.filter((row) =>
        outboxIdCounts.has(row.eventId) && outboxTypeById.get(row.eventId) !== eventType
      ).map((row) => row.eventId),
    ]).size
    const wrongSubjectEventIdCount = new Set([
      ...publishedRows.filter((row) =>
        canonicalIdCounts.has(row.eventId) &&
        (canonicalSubjectById.get(row.eventId) !== row.resourceId ||
          canonicalRows.find((canonicalRow) => canonicalRow?.eventId === row.eventId)?.targetType !== 'User')
      ).map((row) => row.eventId),
      ...canonicalRowsForType.filter((row) => {
        const source = outboxRows.find((outboxRow) => outboxRow?.eventId === row.eventId)
        return source && (row.targetType !== 'User' || row.targetId !== source.resourceId)
      }).map((row) => row.eventId),
    ]).size
    const duplicateOutboxIdempotencyKeyForTypeCount = new Set(outboxRows
      .filter((row) =>
        row?.eventType === eventType && safeIdempotencyKey(row.idempotencyKey) &&
        outboxKeyCounts.get(row.idempotencyKey) > 1
      )
      .map((row) => row.idempotencyKey)).size

    byEventType[eventType] = {
      matchedEventIdCount,
      unmatchedPublishedEventIdCount,
      unmatchedCanonicalEventIdCount,
      duplicateOutboxEventIdCount,
      duplicateCanonicalEventIdCount,
      wrongActionEventIdCount,
      wrongSubjectEventIdCount,
      duplicateOutboxIdempotencyKeyCount: duplicateOutboxIdempotencyKeyForTypeCount,
    }
  }

  return {
    byEventType,
    invalidOutboxRowCount: invalidOutboxRows.length,
    invalidCanonicalRowCount: invalidCanonicalRows.length,
    invalidIdempotencyKeyCount,
    duplicateOutboxIdempotencyKeyCount,
    totalMatchedEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.matchedEventIdCount, 0),
    totalUnmatchedPublishedEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.unmatchedPublishedEventIdCount, 0),
    totalUnmatchedCanonicalEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.unmatchedCanonicalEventIdCount, 0),
    totalDuplicateOutboxEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.duplicateOutboxEventIdCount, 0),
    totalDuplicateCanonicalEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.duplicateCanonicalEventIdCount, 0),
    totalWrongActionEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.wrongActionEventIdCount, 0),
    totalWrongSubjectEventIdCount: Object.values(byEventType).reduce((sum, value) => sum + value.wrongSubjectEventIdCount, 0),
  }
}

/**
 * Reconcile raw, correlation-scoped event identifiers in memory. This function
 * returns aggregate counts only; callers must not persist the raw query rows or
 * event IDs. Matching row counts are never accepted as a substitute for
 * one-to-one eventId/action identity.
 */
export function evaluateMfaAuditDelivery(outboxInput, canonicalAuditInput) {
  const outbox = Array.isArray(outboxInput) ? outboxInput : []
  const audit = Array.isArray(canonicalAuditInput) ? canonicalAuditInput : []
  const idReconciliation = reconcileEventIds(outbox, audit)
  const discoveredTypes = [...new Set([
    ...outbox.map((row) => row?.eventType),
    ...audit.map((row) => row?.action),
  ].filter((value) => typeof value === 'string'))].sort()
  const eventTypes = [...new Set([...discoveredTypes, ...allKnownEventTypes])].sort()

  const events = eventTypes.map((eventType) =>
    summarizeEventType(eventType, outbox, audit, idReconciliation))

  const requiredChecks = REQUIRED_MFA_AUDIT_EVENT_TYPES.map((eventType) => {
    const found = events.find((event) => event.eventType === eventType)
    return {
      name: 'required_event_' + eventType,
      eventType,
      pass: Boolean(found && found.publishedCount > 0 &&
        found.canonicalAuditCount > 0 && found.persistedExactlyOnce),
    }
  })
  const allOutboxSettled = outbox.length > 0 &&
    outbox.every((row) => row && row.status === 'PUBLISHED' &&
      typeof row.eventType === 'string' && allKnownEventTypes.has(row.eventType))
  const persistedExactlyOnce = outbox.length > 0 &&
    idReconciliation.invalidOutboxRowCount === 0 &&
    idReconciliation.invalidCanonicalRowCount === 0 &&
    idReconciliation.totalUnmatchedPublishedEventIdCount === 0 &&
    idReconciliation.totalUnmatchedCanonicalEventIdCount === 0 &&
    idReconciliation.totalDuplicateOutboxEventIdCount === 0 &&
    idReconciliation.totalDuplicateCanonicalEventIdCount === 0 &&
    idReconciliation.totalWrongActionEventIdCount === 0 &&
    idReconciliation.totalWrongSubjectEventIdCount === 0 &&
    idReconciliation.duplicateOutboxIdempotencyKeyCount === 0 &&
    idReconciliation.invalidIdempotencyKeyCount === 0 &&
    idReconciliation.totalMatchedEventIdCount === outbox.filter((row) => row.status === 'PUBLISHED').length &&
    outbox.every((row) => row.status === 'PUBLISHED') &&
    audit.length === outbox.length
  const expectedEventsPresent = requiredChecks.every((check) => check.pass)
  const scenarioSpecificCoverage = SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES.map((eventType) => {
    const found = events.find((event) => event.eventType === eventType)
    return {
      eventType,
      observedCount: found?.totalCount ?? 0,
      persistedCount: found?.matchedEventIdCount ?? 0,
      verified: Boolean(found && found.totalCount > 0 && found.persistedExactlyOnce),
    }
  })
  const allTenEventTypesVerified =
    idReconciliation.invalidOutboxRowCount === 0 &&
    idReconciliation.invalidCanonicalRowCount === 0 &&
    idReconciliation.totalWrongSubjectEventIdCount === 0 &&
    idReconciliation.duplicateOutboxIdempotencyKeyCount === 0 &&
    idReconciliation.invalidIdempotencyKeyCount === 0 &&
    [...REQUIRED_MFA_AUDIT_EVENT_TYPES, ...SCENARIO_SPECIFIC_MFA_AUDIT_EVENT_TYPES]
      .every((eventType) => {
        const found = events.find((event) => event.eventType === eventType)
        return Boolean(found && found.totalCount > 0 && found.persistedExactlyOnce)
      })
  const checks = [
    ...requiredChecks,
    { name: 'all_correlated_outbox_events_published', pass: allOutboxSettled },
    { name: 'canonical_w06_audit_event_ids_match_outbox_event_ids', pass: persistedExactlyOnce },
    { name: 'outbox_idempotency_keys_are_unique_and_valid', pass:
      idReconciliation.invalidIdempotencyKeyCount === 0 &&
      idReconciliation.duplicateOutboxIdempotencyKeyCount === 0 },
    { name: 'canonical_w06_target_matches_outbox_subject', pass:
      idReconciliation.totalWrongSubjectEventIdCount === 0 &&
      idReconciliation.invalidCanonicalRowCount === 0 },
  ]

  return {
    pass: checks.every((check) => check.pass),
    expectedEventsPresent,
    allOutboxSettled,
    persistedExactlyOnce,
    allTenEventTypesVerified,
    scenarioSpecificCoverage,
    invalidOutboxRowCount: idReconciliation.invalidOutboxRowCount,
    invalidCanonicalRowCount: idReconciliation.invalidCanonicalRowCount,
    totalMatchedEventIdCount: idReconciliation.totalMatchedEventIdCount,
    totalUnmatchedPublishedEventIdCount: idReconciliation.totalUnmatchedPublishedEventIdCount,
    totalUnmatchedCanonicalEventIdCount: idReconciliation.totalUnmatchedCanonicalEventIdCount,
    totalDuplicateOutboxEventIdCount: idReconciliation.totalDuplicateOutboxEventIdCount,
    totalDuplicateCanonicalEventIdCount: idReconciliation.totalDuplicateCanonicalEventIdCount,
    totalWrongActionEventIdCount: idReconciliation.totalWrongActionEventIdCount,
    totalWrongSubjectEventIdCount: idReconciliation.totalWrongSubjectEventIdCount,
    duplicateOutboxIdempotencyKeyCount: idReconciliation.duplicateOutboxIdempotencyKeyCount,
    invalidIdempotencyKeyCount: idReconciliation.invalidIdempotencyKeyCount,
    correlatedEventTypes: events.filter((event) => event.totalCount > 0 || event.canonicalAuditCount > 0).length,
    checks,
    events,
  }
}
