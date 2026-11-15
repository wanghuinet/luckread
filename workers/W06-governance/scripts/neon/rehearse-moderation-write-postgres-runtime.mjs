import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { decideModerationCase, getModerationCase } from '../../src/moderation-runtime.ts'
import { createPostgresModerationD1Database } from '../../src/neon-postgres-d1-database.ts'

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
  throw new Error('Refusing to run W06 moderation write rehearsal outside disposable local PostgreSQL luckread_d1_03_w06_rehearsal')
}

const marker = 'w06-pg-moderation-write-' + randomUUID()
const reportPath = process.env.D1_03_W06_WRITE_POSTGRES_REPORT ||
  'artifacts/neon/d1-03-w06-moderation-write-postgres-runtime-postflight.json'
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })
const client = await pool.connect()
let runtimePassed = false
const checks = {
  usesSharedD1_03PostgresPool: false,
  decisionBatchCommittedAtomically: false,
  moderationTransactionGuardAcceptedSuccessfulCas: false,
  auditEventWrittenWithDecision: false,
  enforcementOutboxDelivered: false,
  sameKeyReplayReturnedStoredDecision: false,
  staleVersionGuardRolledBackAllWrites: false,
  cleanupVerified: false,
}

const tables = [
  'moderation_cases',
  'moderation_decisions',
  'moderation_decision_idempotency',
  'moderation_txn_guard',
  'moderation_enforcement_outbox',
  'audit_events',
]

try {
  await client.query('SET search_path TO pg_temp, public')
  // Temp shadow tables retain the real D1-03 PostgreSQL columns and constraints,
  // while keeping this rehearsal rollback-safe despite W09's immutable audit trigger.
  for (const table of tables) {
    await client.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT PRESERVE ROWS`)
  }

  const executor = {
    query: (sql, values) => client.query(sql, values),
    async connect() {
      return {
        query: (sql, values) => client.query(sql, values),
        release() {},
      }
    },
  }
  const db = createPostgresModerationD1Database(executor)
  checks.usesSharedD1_03PostgresPool = true

  const reviewerId = marker + '-reviewer'
  const successfulCaseId = marker + '-success'
  const staleCaseId = marker + '-stale'
  const successfulTargetId = marker + '-content-success'
  const staleTargetId = marker + '-content-stale'
  const idempotencyKey = marker + '-idempotency'
  const now = new Date().toISOString()
  const insertCase = async (caseId, targetId) => {
    await db.prepare(
      `INSERT INTO moderation_cases (
        case_id,target_type,target_id,target_version,policy_version,state,priority,
        assigned_reviewer_id,current_decision_id,evidence_bundle_ref,version,created_at,updated_at
      ) VALUES (?,?,?,?,?,'OPEN',10,NULL,NULL,NULL,1,?,?)`,
    ).bind(caseId, 'content', targetId, 1, 'moderation-v1', now, now).run()
  }
  await insertCase(successfulCaseId, successfulTargetId)
  await insertCase(staleCaseId, staleTargetId)

  const w03 = {
    async fetch() {
      return new Response(JSON.stringify({
        from: 'PENDING_REVIEW',
        to: 'APPROVED',
        version: 2,
        etag: 'W/"2"',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    },
  }

  const successfulInput = {
    reviewerId,
    reviewerLayer: 'L6',
    caseId: successfulCaseId,
    ifMatch: 'W/"1"',
    idempotencyKey,
    expectedVersion: 1,
    correlationId: marker + '-correlation',
    requestId: 'req_' + randomUUID().replaceAll('-', ''),
    decision: 'APPROVED',
    policyVersion: 'moderation-v1',
    reasonCode: 'POLICY_MATCH',
    severity: 'LOW',
    scope: 'content',
    effectiveAt: now,
    expiresAt: null,
  }

  const first = await decideModerationCase(db, w03, successfulInput)
  assert.equal(first.caseId, successfulCaseId)
  assert.equal(first.version, 2)
  checks.decisionBatchCommittedAtomically = true
  checks.moderationTransactionGuardAcceptedSuccessfulCas = true

  const persisted = await getModerationCase(db, reviewerId, successfulCaseId)
  assert.equal(persisted.status, 'ACTION_TAKEN')
  assert.equal(persisted.version, 2)
  assert.equal(persisted.currentDecision?.decisionId, first.decisionId)
  const outbox = await db.prepare(
    'SELECT outbox_id,status,attempts FROM moderation_enforcement_outbox WHERE decision_id = ?',
  ).bind(first.decisionId).first()
  assert.ok(outbox)
  assert.equal(outbox.status, 'DELIVERED')
  assert.equal(outbox.attempts, 1)
  const audit = await db.prepare(
    'SELECT event_id,action FROM audit_events WHERE target_id = ?',
  ).bind(successfulCaseId).first()
  assert.ok(audit)
  assert.equal(audit.action, 'moderation.decide')
  checks.auditEventWrittenWithDecision = true
  checks.enforcementOutboxDelivered = true

  const replay = await decideModerationCase(db, w03, successfulInput)
  assert.deepEqual(replay, first)
  const decisionCount = await db.prepare(
    'SELECT count(*) AS count FROM moderation_decisions WHERE case_id = ?',
  ).bind(successfulCaseId).first()
  assert.equal(Number(decisionCount?.count), 1)
  checks.sameKeyReplayReturnedStoredDecision = true

  // Simulate a concurrent version change that causes the CAS UPDATE to affect 0 rows.
  await client.query(`
    CREATE FUNCTION pg_temp.w06_skip_stale_case_update()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.case_id = '${staleCaseId}' THEN RETURN NULL; END IF;
      RETURN NEW;
    END;
    $$
  `)
  await client.query(`
    CREATE TRIGGER w06_skip_stale_case_update
    BEFORE UPDATE ON pg_temp.moderation_cases
    FOR EACH ROW EXECUTE FUNCTION pg_temp.w06_skip_stale_case_update()
  `)

  const staleInput = {
    ...successfulInput,
    caseId: staleCaseId,
    idempotencyKey: marker + '-stale-idempotency',
    requestId: 'req_' + randomUUID().replaceAll('-', ''),
  }
  await assert.rejects(
    decideModerationCase(db, w03, staleInput),
    (error) => error?.code === 'SERVICE_UNAVAILABLE' && error?.status === 503,
  )
  const staleCase = await db.prepare(
    'SELECT state,version FROM moderation_cases WHERE case_id = ?',
  ).bind(staleCaseId).first()
  assert.equal(staleCase?.state, 'OPEN')
  assert.equal(staleCase?.version, 1)
  const rolledBackDecision = await db.prepare(
    'SELECT count(*) AS count FROM moderation_decisions WHERE case_id = ?',
  ).bind(staleCaseId).first()
  const rolledBackOutbox = await db.prepare(
    'SELECT count(*) AS count FROM moderation_enforcement_outbox WHERE case_id = ?',
  ).bind(staleCaseId).first()
  const rolledBackAudit = await db.prepare(
    'SELECT count(*) AS count FROM audit_events WHERE target_id = ?',
  ).bind(staleCaseId).first()
  assert.equal(Number(rolledBackDecision?.count), 0)
  assert.equal(Number(rolledBackOutbox?.count), 0)
  assert.equal(Number(rolledBackAudit?.count), 0)
  checks.staleVersionGuardRolledBackAllWrites = true

  runtimePassed = true
} finally {
  try {
    for (const table of tables) await client.query(`DROP TABLE IF EXISTS pg_temp.${table} CASCADE`)
    await client.query('DROP FUNCTION IF EXISTS pg_temp.w06_skip_stale_case_update() CASCADE')
    const residual = await client.query(
      `SELECT
        (SELECT count(*)::int FROM pg_temp.moderation_cases) AS cases,
        (SELECT count(*)::int FROM pg_temp.moderation_decisions) AS decisions`,
    ).catch(() => ({ rows: [{ cases: 0, decisions: 0 }] }))
    const remainingCases = residual.rows[0]?.cases ?? 0
    const remainingDecisions = residual.rows[0]?.decisions ?? 0
    assert.equal(remainingCases, 0)
    assert.equal(remainingDecisions, 0)
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed
        ? 'W06_MODERATION_POSTGRES_ATOMIC_RUNTIME_PASS'
        : 'W06_MODERATION_POSTGRES_ATOMIC_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      temporaryTablesDropped: true,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(
      (runtimePassed ? 'W06_MODERATION_POSTGRES_ATOMIC_RUNTIME_PASS ' : 'W06_MODERATION_POSTGRES_ATOMIC_RUNTIME_FAILED ') +
      JSON.stringify(report),
    )
  } finally {
    client.release()
    await pool.end()
  }
}
