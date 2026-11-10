import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { listModerationQueue } from '../../src/moderation-runtime.ts'
import { createPostgresModerationQueueReadStore } from '../../src/moderation-queue-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.D1_03_W06_LOCAL_DATABASE_URL
if (!connectionString) throw new Error('D1_03_W06_LOCAL_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_d1_03_w06_rehearsal'
) {
  throw new Error('Refusing to run W06 moderation queue rehearsal outside disposable local PostgreSQL luckread_d1_03_w06_rehearsal')
}

const marker = 'w06-pg-moderation-queue-' + randomUUID()
const reportPath = process.env.D1_03_W06_QUEUE_POSTGRES_REPORT ||
  'artifacts/neon/d1-03-w06-moderation-queue-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresModerationQueueReadStore(pool)
let runtimePassed = false
const checks = {
  reviewerScopePreserved: false,
  openQueueStatesOnly: false,
  contentTargetScopePreserved: false,
  unassignedAndAssignedCasesVisible: false,
  currentDecisionProjectionPreserved: false,
  stablePriorityCreatedAtCaseIdOrdering: false,
  pageSizePlusOneHasMorePreserved: false,
  keysetCursorPreservesMicroseconds: false,
  nextPageHasNoDuplicates: false,
  cleanupVerified: false,
}

const insertCase = async (input) => {
  await pool.query(
    `INSERT INTO moderation_cases (
       case_id,target_type,target_id,target_version,policy_version,state,priority,
       assigned_reviewer_id,current_decision_id,evidence_bundle_ref,version,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz)`,
    [
      input.caseId,
      input.targetType,
      input.targetId,
      1,
      'moderation-v1',
      input.state,
      input.priority,
      input.assignedReviewerId,
      input.decisionId,
      null,
      input.version ?? 1,
      input.createdAt,
      input.createdAt,
    ],
  )
}

const insertDecision = async (input) => {
  await pool.query(
    `INSERT INTO moderation_decisions (
       decision_id,case_id,case_version,outcome,target_type,target_id,target_version,
       policy_version,reason_code,severity,scope,effective_at,expires_at,source_kind,
       reviewer_id,reviewer_layer,request_id,created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13,$14,$15,$16,$17,$18::timestamptz)`,
    [
      input.decisionId,
      input.caseId,
      2,
      'APPROVED',
      'content',
      input.targetId,
      1,
      'moderation-v1',
      'POLICY_MATCH',
      'low',
      'content',
      input.effectiveAt,
      null,
      'HUMAN_REVIEW',
      input.reviewerId,
      'L6',
      'req_' + input.caseId.replaceAll('-', '').slice(0, 32),
      input.effectiveAt,
    ],
  )
}

try {
  const reviewer = marker + '-reviewer'
  const otherReviewer = marker + '-other-reviewer'
  const caseA = marker + '-case-a'
  const caseB = marker + '-case-b'
  const caseC = marker + '-case-c'
  const caseOtherReviewer = marker + '-case-other-reviewer'
  const caseClosed = marker + '-case-closed'
  const caseNonContent = marker + '-case-non-content'
  const decisionA = marker + '-decision-a'

  // Same priority uses oldest first; lower priority follows the complete higher-priority group.
  await insertCase({
    caseId: caseB,
    targetType: 'content',
    targetId: marker + '-content-b',
    state: 'UNDER_REVIEW',
    priority: 90,
    assignedReviewerId: reviewer,
    decisionId: null,
    createdAt: '2026-11-10T04:03:00.000123Z',
  })
  await insertCase({
    caseId: caseA,
    targetType: 'content',
    targetId: marker + '-content-a',
    state: 'OPEN',
    priority: 90,
    assignedReviewerId: null,
    decisionId: decisionA,
    version: 2,
    createdAt: '2026-11-10T04:02:00.000123Z',
  })
  await insertCase({
    caseId: caseC,
    targetType: 'content',
    targetId: marker + '-content-c',
    state: 'ESCALATED',
    priority: 80,
    assignedReviewerId: null,
    decisionId: null,
    createdAt: '2026-11-10T04:00:00.000123Z',
  })
  await insertCase({
    caseId: caseOtherReviewer,
    targetType: 'content',
    targetId: marker + '-content-other',
    state: 'OPEN',
    priority: 1000,
    assignedReviewerId: otherReviewer,
    decisionId: null,
    createdAt: '2026-11-10T04:01:00.000123Z',
  })
  await insertCase({
    caseId: caseClosed,
    targetType: 'content',
    targetId: marker + '-content-closed',
    state: 'CLOSED',
    priority: 900,
    assignedReviewerId: null,
    decisionId: null,
    createdAt: '2026-11-10T04:01:30.000123Z',
  })
  await insertCase({
    caseId: caseNonContent,
    targetType: 'profile',
    targetId: marker + '-profile',
    state: 'OPEN',
    priority: 800,
    assignedReviewerId: null,
    decisionId: null,
    createdAt: '2026-11-10T04:01:45.000123Z',
  })
  await insertDecision({
    decisionId: decisionA,
    caseId: caseA,
    targetId: marker + '-content-a',
    reviewerId: reviewer,
    effectiveAt: '2026-11-10T04:02:00.000123Z',
  })

  const firstPage = await listModerationQueue(store, reviewer, null, 2)
  assert.deepEqual(firstPage.items.map((item) => item.caseId), [caseA, caseB])
  assert.equal(firstPage.hasMore, true)
  assert.ok(firstPage.nextCursor)
  assert.equal(firstPage.items[0]?.currentDecision?.decisionId, decisionA)
  assert.equal(firstPage.items[0]?.currentDecision?.effectiveAt, '2026-11-10T04:02:00.000123Z')
  assert.equal(firstPage.items.some((item) => item.caseId === caseOtherReviewer), false)
  assert.equal(firstPage.items.some((item) => item.caseId === caseClosed), false)
  assert.equal(firstPage.items.some((item) => item.caseId === caseNonContent), false)
  checks.reviewerScopePreserved = true
  checks.openQueueStatesOnly = true
  checks.contentTargetScopePreserved = true
  checks.unassignedAndAssignedCasesVisible =
    firstPage.items[0]?.caseId === caseA && firstPage.items[1]?.caseId === caseB
  checks.currentDecisionProjectionPreserved =
    firstPage.items[0]?.currentDecision?.decisionId === decisionA
  checks.stablePriorityCreatedAtCaseIdOrdering = true
  checks.pageSizePlusOneHasMorePreserved = firstPage.hasMore && firstPage.items.length === 2

  const secondPage = await listModerationQueue(store, reviewer, firstPage.nextCursor, 2)
  assert.deepEqual(secondPage.items.map((item) => item.caseId), [caseC])
  assert.equal(secondPage.hasMore, false)
  assert.equal(secondPage.nextCursor, null)
  assert.equal(
    new Set([...firstPage.items, ...secondPage.items].map((item) => item.caseId)).size,
    3,
  )
  checks.keysetCursorPreservesMicroseconds =
    firstPage.nextCursor !== null && secondPage.items[0]?.caseId === caseC
  checks.nextPageHasNoDuplicates = true

  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM moderation_decisions WHERE case_id LIKE $1 OR decision_id LIKE $1',
      [marker + '%'],
    )
    await pool.query('DELETE FROM moderation_cases WHERE case_id LIKE $1', [marker + '%'])
    const residual = await pool.query(
      'SELECT (SELECT count(*)::int FROM moderation_cases WHERE case_id LIKE $1) AS cases, (SELECT count(*)::int FROM moderation_decisions WHERE case_id LIKE $1 OR decision_id LIKE $1) AS decisions',
      [marker + '%'],
    )
    const remainingCases = residual.rows[0]?.cases ?? -1
    const remainingDecisions = residual.rows[0]?.decisions ?? -1
    assert.equal(remainingCases, 0, 'All synthetic moderation cases must be removed')
    assert.equal(remainingDecisions, 0, 'All synthetic moderation decisions must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed
        ? 'W06_MODERATION_QUEUE_POSTGRES_RUNTIME_PASS'
        : 'W06_MODERATION_QUEUE_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: { cases: remainingCases, decisions: remainingDecisions },
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(
      (runtimePassed ? 'W06_MODERATION_QUEUE_POSTGRES_RUNTIME_PASS ' : 'W06_MODERATION_QUEUE_POSTGRES_RUNTIME_FAILED ') +
      JSON.stringify(report),
    )
  } finally {
    await pool.end()
  }
}
