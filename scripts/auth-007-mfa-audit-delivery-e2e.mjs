import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { evaluateMfaAuditDelivery } from './auth-007-mfa-audit-evidence.mjs'

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || ''
const apiToken = process.env.CLOUDFLARE_API_TOKEN || ''
const qaEmail = process.env.LUCKREAD_AUTH007_MFA_E2E_EMAIL || ''
const runId = process.env.GITHUB_RUN_ID || ''
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.LUCKREAD_SOURCE_SHA || process.env.GITHUB_SHA || 'unknown'
const correlationId = `req_auth007mfa_${runId}_${runAttempt}`
const evidenceDir = resolve('artifacts/mapping-0/auth-007-mfa-audit-delivery-e2e')
const evidencePath = resolve(evidenceDir, `auth-007-mfa-audit-delivery-e2e-${runId || 'local'}-${runAttempt}.json`)
const maxWaitMs = 180_000
const pollIntervalMs = 5_000

const databases = {
  W02_D1_01: '2f80471e-3756-49f9-8db1-7707a433ad64',
  W06_D1_03: 'bda1d247-a371-4244-91ae-aef96034db7f',
}

const evidence = {
  evidenceType: 'AUTH-007_MFA_AUDIT_DELIVERY_E2E',
  timestamp: new Date().toISOString(),
  workflowRunId: runId || null,
  workflowRunAttempt: runAttempt,
  sourceSha,
  correlationId,
  credentialsLogged: false,
  apiTokenStored: false,
  rawResponseBodiesStored: false,
  rawEventPayloadsStored: false,
  queryResultsStoredAsAggregates: true,
  eventIdsComparedInMemoryOnly: true,
  rawEventIdentifiersStored: false,
  userIdentifiersStored: false,
  qaEmailStored: false,
  qaAccountResolved: false,
  databaseIdsStored: false,
  sqlMutationsPerformed: false,
  queryMode: 'READ_ONLY_SELECT_ONLY',
  checks: [],
  outboxEvents: [],
  canonicalAuditEvents: [],
  eventIdReconciliation: null,
  scenarioSpecificCoverage: [],
  allTenEventTypesVerified: false,
  status: 'PENDING',
  failureCode: null,
  pollingDurationMs: 0,
}

const check = (name, pass, facts = {}) => {
  evidence.checks.push({ name, pass, ...facts })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
  return pass
}

const failureCodeFrom = (error) =>
  error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : 'AUDIT_EVIDENCE_CHECK_FAILED'

async function queryD1(databaseId, sql, params) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|PRAGMA|ATTACH|DETACH)\b/i.test(sql)) {
    const error = new Error('readonly query guard rejected SQL')
    error.code = 'READ_ONLY_QUERY_GUARD_REJECTED_SQL'
    throw error
  }
  let response
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${databaseId}/query`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ sql, params }),
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      },
    )
  } catch {
    const error = new Error('Cloudflare D1 read-only query transport failed')
    error.code = 'CLOUDFLARE_D1_QUERY_TRANSPORT'
    throw error
  }
  if (!response.ok) {
    const error = new Error('Cloudflare D1 read-only query failed')
    error.code = `CLOUDFLARE_D1_QUERY_HTTP_${response.status}`
    throw error
  }
  let payload
  try {
    payload = await response.json()
  } catch {
    const error = new Error('Cloudflare D1 query response was not JSON')
    error.code = 'CLOUDFLARE_D1_QUERY_INVALID_RESPONSE'
    throw error
  }
  if (payload?.success !== true || !Array.isArray(payload.result)) {
    const error = new Error('Cloudflare D1 query did not return a successful result')
    error.code = 'CLOUDFLARE_D1_QUERY_REJECTED'
    throw error
  }

  const results = payload.result
  const mutated = results.some((item) =>
    item?.meta?.changed_db === true ||
    Number(item?.meta?.rows_written || 0) > 0 ||
    Number(item?.meta?.changes || 0) > 0)
  if (mutated) {
    evidence.sqlMutationsPerformed = true
    const error = new Error('D1 query metadata indicates a database mutation')
    error.code = 'READ_ONLY_QUERY_MUTATION_GUARD_TRIGGERED'
    throw error
  }

  for (const item of results) {
    if (item?.success !== true || !Array.isArray(item?.results)) {
      const error = new Error('Cloudflare D1 result set was incomplete')
      error.code = 'CLOUDFLARE_D1_QUERY_INCOMPLETE_RESULT'
      throw error
    }
  }
  return results.flatMap((item) => item.results)
}

async function readDedicatedQaUserId() {
  const rows = await queryD1(
    databases.W02_D1_01,
    'SELECT id FROM "user" WHERE lower(email) = lower(?) LIMIT 2',
    [qaEmail],
  )
  if (rows.length !== 1 || typeof rows[0]?.id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(rows[0].id)) {
    const error = new Error('dedicated MFA QA account was not uniquely resolved')
    error.code = 'DEDICATED_MFA_QA_ACCOUNT_NOT_UNIQUE'
    throw error
  }
  return rows[0].id
}

async function readScopedOutboxEventRows(qaUserId) {
  // Fetch only event IDs and status metadata for an exact in-memory
  // reconciliation. These row identifiers are never written to evidence.
  return queryD1(
    databases.W02_D1_01,
    `SELECT event_id AS eventId, event_type AS eventType, resource_id AS resourceId,
            idempotency_key AS idempotencyKey, status, attempt,
            last_error_code AS lastErrorCode
       FROM auth_007_mfa_publication_journal
      WHERE json_extract(payload, '$.correlationId') = ? AND resource_id = ?
      ORDER BY event_type, event_id`,
    [correlationId, qaUserId],
  )
}

async function readScopedCanonicalAuditEventRows(qaUserId) {
  return queryD1(
    databases.W06_D1_03,
    `SELECT event_id AS eventId, action, target_type AS targetType, target_id AS targetId
       FROM audit_events
      WHERE request_id = ? AND target_id = ? AND action LIKE 'auth.mfa.%'
      ORDER BY action, event_id`,
    [correlationId, qaUserId],
  )
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function writeEvidence() {
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
}

async function main() {
  if (!/^\d+$/.test(runId) || !/^\d+$/.test(runAttempt) ||
      !/^[a-f0-9]{40}$/i.test(sourceSha) ||
      !/^req_[A-Za-z0-9_-]{1,123}$/.test(correlationId)) {
    check('immutable_source_and_run_identity_valid', false)
    evidence.status = 'BLOCKED'
    evidence.failureCode = 'INVALID_RUN_PROVENANCE'
    return
  }
  check('immutable_source_and_run_identity_valid', true)

  if (!/^[a-f0-9]{32}$/i.test(accountId) || apiToken.length < 20 || !qaEmail.includes('@')) {
    check('cloudflare_d1_read_credentials_configured', false)
    evidence.status = 'BLOCKED'
    evidence.failureCode = 'CLOUDFLARE_D1_READ_CREDENTIALS_MISSING'
    return
  }
  check('cloudflare_d1_read_credentials_configured', true)
  check('query_sql_is_read_only_select', true, { databaseAliases: ['W02_D1_01', 'W06_D1_03'] })

  let qaUserId
  try {
    qaUserId = await readDedicatedQaUserId()
    evidence.qaAccountResolved = true
    check('dedicated_qa_account_resolved_for_scope_only', true)
  } catch (error) {
    evidence.status = 'BLOCKED'
    evidence.failureCode = failureCodeFrom(error)
    check('dedicated_qa_account_resolved_for_scope_only', false)
    return
  }

  const startedAt = Date.now()
  const deadline = startedAt + maxWaitMs
  let evaluation = null
  let lastErrorCode = null

  do {
    try {
      const [outboxRows, auditRows] = await Promise.all([
        readScopedOutboxEventRows(qaUserId),
        readScopedCanonicalAuditEventRows(qaUserId),
      ])
      // Match eventId, action, subject, and idempotency identity in memory only.
      // The artifact stores aggregate diagnostics, never raw IDs or account IDs.
      evaluation = evaluateMfaAuditDelivery(outboxRows, auditRows)
      evidence.outboxEvents = evaluation.events
        .filter((row) => row.totalCount > 0)
        .map((row) => ({
          eventType: row.eventType,
          totalCount: row.totalCount,
          publishedCount: row.publishedCount,
          pendingCount: row.pendingCount,
          failedCount: row.failedCount,
          outboxSettled: row.outboxSettled,
        }))
      evidence.canonicalAuditEvents = evaluation.events
        .filter((row) => row.canonicalAuditCount > 0)
        .map((row) => ({ action: row.eventType, count: row.canonicalAuditCount }))
      evidence.eventIdReconciliation = {
        matchedEventIdCount: evaluation.totalMatchedEventIdCount,
        unmatchedPublishedEventIdCount: evaluation.totalUnmatchedPublishedEventIdCount,
        unmatchedCanonicalEventIdCount: evaluation.totalUnmatchedCanonicalEventIdCount,
        duplicateOutboxEventIdCount: evaluation.totalDuplicateOutboxEventIdCount,
        duplicateCanonicalEventIdCount: evaluation.totalDuplicateCanonicalEventIdCount,
        wrongActionEventIdCount: evaluation.totalWrongActionEventIdCount,
        wrongSubjectEventIdCount: evaluation.totalWrongSubjectEventIdCount,
        duplicateOutboxIdempotencyKeyCount: evaluation.duplicateOutboxIdempotencyKeyCount,
        invalidIdempotencyKeyCount: evaluation.invalidIdempotencyKeyCount,
        invalidOutboxRowCount: evaluation.invalidOutboxRowCount,
        invalidCanonicalRowCount: evaluation.invalidCanonicalRowCount,
      }
      evidence.scenarioSpecificCoverage = evaluation.scenarioSpecificCoverage
      evidence.allTenEventTypesVerified = evaluation.allTenEventTypesVerified
      evidence.checks = evidence.checks.filter((entry) =>
        !entry.name.startsWith('required_event_') &&
        entry.name !== 'all_correlated_outbox_events_published' &&
        entry.name !== 'canonical_w06_audit_event_ids_match_outbox_event_ids' &&
        entry.name !== 'outbox_idempotency_keys_are_unique_and_valid' &&
        entry.name !== 'canonical_w06_target_matches_outbox_subject')
      evidence.checks.push(...evaluation.checks)
      evidence.pollingDurationMs = Date.now() - startedAt
      evidence.failureCode = null
      if (evaluation.pass) {
        evidence.status = 'PASS'
        break
      }
      lastErrorCode = 'MFA_AUDIT_DELIVERY_NOT_CONVERGED'
      if (Date.now() >= deadline) {
        evidence.status = 'FAIL'
        evidence.failureCode = lastErrorCode
        break
      }
    } catch (error) {
      lastErrorCode = failureCodeFrom(error)
      evidence.pollingDurationMs = Date.now() - startedAt
      const retryable = lastErrorCode === 'CLOUDFLARE_D1_QUERY_TRANSPORT' ||
        ['CLOUDFLARE_D1_QUERY_HTTP_408', 'CLOUDFLARE_D1_QUERY_HTTP_429',
          'CLOUDFLARE_D1_QUERY_HTTP_500', 'CLOUDFLARE_D1_QUERY_HTTP_502',
          'CLOUDFLARE_D1_QUERY_HTTP_503', 'CLOUDFLARE_D1_QUERY_HTTP_504'].includes(lastErrorCode)
      if (Date.now() >= deadline || !retryable) {
        evidence.status = 'BLOCKED'
        evidence.failureCode = lastErrorCode
        break
      }
    }
    await sleep(pollIntervalMs)
  } while (Date.now() < deadline)

  if (evidence.status === 'PENDING') {
    evidence.status = 'FAIL'
    evidence.failureCode = lastErrorCode || 'MFA_AUDIT_DELIVERY_NOT_CONVERGED'
  }
  check('expected_w02_outbox_and_w06_audit_delivery_converged', evidence.status === 'PASS', {
    correlatedOutboxEventTypes: evidence.outboxEvents.length,
    canonicalAuditTypes: evidence.canonicalAuditEvents.length,
    exactEventIdMatches: evidence.eventIdReconciliation?.matchedEventIdCount ?? 0,
    eventIdMismatchCount:
      (evidence.eventIdReconciliation?.unmatchedPublishedEventIdCount ?? 0) +
      (evidence.eventIdReconciliation?.unmatchedCanonicalEventIdCount ?? 0),
    wrongSubjectEventIdCount: evidence.eventIdReconciliation?.wrongSubjectEventIdCount ?? 0,
    duplicateOutboxIdempotencyKeyCount: evidence.eventIdReconciliation?.duplicateOutboxIdempotencyKeyCount ?? 0,
    invalidIdempotencyKeyCount: evidence.eventIdReconciliation?.invalidIdempotencyKeyCount ?? 0,
    allTenEventTypesVerified: evidence.allTenEventTypesVerified,
    scenarioSpecificEventsObserved: evidence.scenarioSpecificCoverage.filter((item) => item.observedCount > 0).length,
    pollingDurationMs: evidence.pollingDurationMs,
  })
  if (evidence.status !== 'PASS' && evidence.failureCode) {
    console.error(`MFA audit delivery evidence status=${evidence.status} code=${evidence.failureCode}`)
  }
}

try {
  await main()
} catch (error) {
  evidence.status = 'BLOCKED'
  evidence.failureCode = failureCodeFrom(error)
  check('unexpected_audit_verification_error', false)
} finally {
  evidence.timestamp = new Date().toISOString()
  await writeEvidence()
}

console.log(JSON.stringify({
  evidenceType: evidence.evidenceType,
  status: evidence.status,
  failureCode: evidence.failureCode,
  checkCount: evidence.checks.length,
  passedChecks: evidence.checks.filter((entry) => entry.pass).length,
  sourceSha: evidence.sourceSha,
  workflowRunId: evidence.workflowRunId,
  correlationId: evidence.correlationId,
  evidencePath,
}))

if (evidence.status !== 'PASS') process.exitCode = 1
