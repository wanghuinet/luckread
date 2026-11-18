import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import worker from '../../src/index.ts'
import {
  closeW06ModerationPostgresRuntimeForTest,
} from '../../src/neon/moderation-database-runtime.js'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const adminConnectionString = process.env.W06_ENTRY_POSTGRES_ADMIN_URL
const connectionString = process.env.W06_ENTRY_POSTGRES_DATABASE_URL
if (!adminConnectionString || !connectionString) {
  throw new Error('W06_ENTRY_POSTGRES_ADMIN_URL and W06_ENTRY_POSTGRES_DATABASE_URL are required')
}

const adminTarget = new URL(adminConnectionString)
const target = new URL(connectionString)
if (!['127.0.0.1', 'localhost'].includes(adminTarget.hostname) ||
    adminTarget.port !== '5432' || adminTarget.pathname !== '/postgres' ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    target.port !== '5432' || target.pathname !== '/luckread_governance') {
  throw new Error('Refusing W06 entrypoint rehearsal outside disposable local PostgreSQL luckread_governance')
}

const reportPath = process.env.W06_ENTRY_POSTGRES_REPORT ||
  '../../artifacts/neon/w06-moderation-entrypoint-postgres-runtime-postflight.json'
const adminPool = new Pool({ connectionString: adminConnectionString, max: 1, connectionTimeoutMillis: 5_000 })
let pool
const binding = { connectionString }
const marker = 'w06-entry-pg18-' + randomUUID().replaceAll('-', '')
const reviewerId = marker + '-reviewer'
const successfulCaseId = marker + '-success'
const staleCaseId = marker + '-stale'
const effectiveAt = new Date().toISOString()
const requestId = 'req_' + randomUUID().replaceAll('-', '')
const correlationId = marker + '-correlation'
const successKey = marker + '-decision-idempotency'
const checks = {
  selectsNeonWorkerEntryWithNoD1Binding: false,
  decisionRequestPassesW01AndCASLHeaders: false,
  postgresDecisionAndAuditCommitted: false,
  enforcementOutboxDelivered: false,
  sameKeyReplayReturnsStoredDecision: false,
  staleVersionFailureRollsBackAllWrites: false,
  disposableDatabaseDropped: false,
}
let passed = false
let failure

function decisionRequest(caseId, key, requestIdValue) {
  return new Request('https://w06.internal/admin/moderation/cases/' + encodeURIComponent(caseId) + '/decision', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-LuckRead-Caller': 'W01',
      'X-LuckRead-Transport-Version': '1.0',
      'X-LuckRead-Principal-User-Id': reviewerId,
      'X-LuckRead-Principal-Layer': 'L6',
      'X-LuckRead-Correlation-Id': correlationId,
      'X-LuckRead-Request-Id': requestIdValue,
      'X-LuckRead-Authz-Decision': 'ALLOW',
      'X-LuckRead-Authz-Permission': 'moderation.decide',
      'X-LuckRead-Authz-Resource-Type': 'ModerationCase',
      'X-LuckRead-Authz-Policy-Version': 'casl-l0-l8-v1',
      'X-LuckRead-Authz-Subject-Id': reviewerId,
      'X-LuckRead-Authz-Layer': 'L6',
      'If-Match': 'W/"1"',
      'Idempotency-Key': key,
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      expectedVersion: 1,
      policyVersion: 'moderation-v1',
      reasonCode: 'POLICY_MATCH',
      severity: 'LOW',
      scope: 'content',
      effectiveAt,
      expiresAt: null,
    }),
  })
}

async function count(table, whereSql, values) {
  const result = await pool.query(
    `SELECT count(*)::int AS count FROM ${table} WHERE ${whereSql}`,
    values,
  )
  return Number(result.rows[0]?.count ?? -1)
}

try {
  // This database is deliberately disposable and has the exact name accepted
  // by W06's production Hyperdrive runtime guard.
  await adminPool.query('DROP DATABASE IF EXISTS luckread_governance WITH (FORCE)')
  await adminPool.query('CREATE DATABASE luckread_governance')
  pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000 })

  const w06Schema = await readFile(
    new URL('../../src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql', import.meta.url),
    'utf8',
  )
  const w09Schema = await readFile(
    new URL('../../../W09-platform/src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql', import.meta.url),
    'utf8',
  )
  await pool.query(w06Schema)
  await pool.query(w09Schema)

  await pool.query(
    `INSERT INTO moderation_cases (
       case_id,target_type,target_id,target_version,policy_version,state,priority,
       assigned_reviewer_id,current_decision_id,evidence_bundle_ref,version,created_at,updated_at
     ) VALUES ($1,'content',$2,1,'moderation-v1','OPEN',90,NULL,NULL,NULL,1,$3::timestamptz,$3::timestamptz)`,
    [successfulCaseId, marker + '-content-success', effectiveAt],
  )
  await pool.query(
    `INSERT INTO moderation_cases (
       case_id,target_type,target_id,target_version,policy_version,state,priority,
       assigned_reviewer_id,current_decision_id,evidence_bundle_ref,version,created_at,updated_at
     ) VALUES ($1,'content',$2,1,'moderation-v1','OPEN',80,NULL,NULL,NULL,1,$3::timestamptz,$3::timestamptz)`,
    [staleCaseId, marker + '-content-stale', effectiveAt],
  )

  const env = {
    W06_MODERATION_DATABASE_DRIVER: 'neon',
    HYPERDRIVE_D1_03: binding,
    W03_CONTENT_MODERATION: {
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
    },
  }

  checks.selectsNeonWorkerEntryWithNoD1Binding = true

  const firstResponse = await worker.fetch(
    decisionRequest(successfulCaseId, successKey, requestId),
    env,
  )
  assert.equal(firstResponse.status, 200)
  const first = await firstResponse.json()
  assert.equal(first.caseId, successfulCaseId)
  assert.equal(first.outcome, 'APPROVED')
  assert.equal(first.version, 2)
  assert.equal(typeof first.decisionId, 'string')
  checks.decisionRequestPassesW01AndCASLHeaders = true

  const caseRows = await pool.query(
    'SELECT state, version::int AS version, current_decision_id FROM moderation_cases WHERE case_id = $1',
    [successfulCaseId],
  )
  assert.deepEqual(caseRows.rows, [{
    state: 'ACTION_TAKEN',
    version: 2,
    current_decision_id: first.decisionId,
  }])
  const decisions = await pool.query(
    'SELECT decision_id, reviewer_id, outcome FROM moderation_decisions WHERE case_id = $1',
    [successfulCaseId],
  )
  assert.deepEqual(decisions.rows, [{
    decision_id: first.decisionId,
    reviewer_id: reviewerId,
    outcome: 'APPROVED',
  }])
  const audit = await pool.query(
    "SELECT action, target_id FROM audit_events WHERE target_id = $1 AND action = 'moderation.decide'",
    [successfulCaseId],
  )
  assert.deepEqual(audit.rows, [{ action: 'moderation.decide', target_id: successfulCaseId }])
  checks.postgresDecisionAndAuditCommitted = true

  const outbox = await pool.query(
    'SELECT status, attempts::int AS attempts FROM moderation_enforcement_outbox WHERE decision_id = $1',
    [first.decisionId],
  )
  assert.deepEqual(outbox.rows, [{ status: 'DELIVERED', attempts: 1 }])
  checks.enforcementOutboxDelivered = true

  const replayResponse = await worker.fetch(
    decisionRequest(successfulCaseId, successKey, requestId),
    env,
  )
  assert.equal(replayResponse.status, 200)
  assert.deepEqual(await replayResponse.json(), first)
  assert.equal(await count('moderation_decisions', 'case_id = $1', [successfulCaseId]), 1)
  assert.equal(await count('moderation_enforcement_outbox', 'decision_id = $1', [first.decisionId]), 1)
  assert.equal(await count('audit_events', 'target_id = $1 AND action = $2', [successfulCaseId, 'moderation.decide']), 1)
  checks.sameKeyReplayReturnsStoredDecision = true

  // Simulate the stale CAS update returning zero rows. The transaction guard
  // must abort the whole decision batch before W03 is called.
  await pool.query(`
    CREATE FUNCTION w06_entry_skip_stale_case_update()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.case_id = '${staleCaseId}' THEN RETURN NULL; END IF;
      RETURN NEW;
    END;
    $$
  `)
  await pool.query(`
    CREATE TRIGGER w06_entry_skip_stale_case_update
    BEFORE UPDATE ON moderation_cases
    FOR EACH ROW EXECUTE FUNCTION w06_entry_skip_stale_case_update()
  `)

  const staleResponse = await worker.fetch(
    decisionRequest(staleCaseId, marker + '-stale-idempotency', 'req_' + randomUUID().replaceAll('-', '')),
    env,
  )
  assert.equal(staleResponse.status, 503)
  const staleCase = await pool.query(
    'SELECT state, version::int AS version FROM moderation_cases WHERE case_id = $1',
    [staleCaseId],
  )
  assert.deepEqual(staleCase.rows, [{ state: 'OPEN', version: 1 }])
  assert.equal(await count('moderation_decisions', 'case_id = $1', [staleCaseId]), 0)
  assert.equal(await count('moderation_decision_idempotency', 'case_id = $1', [staleCaseId]), 0)
  assert.equal(await count('moderation_enforcement_outbox', 'case_id = $1', [staleCaseId]), 0)
  assert.equal(await count('audit_events', 'target_id = $1', [staleCaseId]), 0)
  checks.staleVersionFailureRollsBackAllWrites = true
  passed = true
} catch (error) {
  failure = error
} finally {
  try {
    if (binding) await closeW06ModerationPostgresRuntimeForTest(binding)
  } catch (closeError) {
    failure ??= closeError
  }
  try {
    await pool?.end()
  } catch (closeError) {
    failure ??= closeError
  }
  try {
    await adminPool.query('DROP DATABASE IF EXISTS luckread_governance WITH (FORCE)')
    checks.disposableDatabaseDropped = true
  } catch (dropError) {
    failure ??= dropError
  }
  try {
    await adminPool.end()
  } catch (closeError) {
    failure ??= closeError
  }

  const report = {
    status: passed && !failure && checks.disposableDatabaseDropped
      ? 'W06_MODERATION_NEON_ENTRY_POSTGRES18_RUNTIME_PASS'
      : 'W06_MODERATION_NEON_ENTRY_POSTGRES18_RUNTIME_FAILED',
    postgresDatabase: target.pathname.slice(1),
    ...checks,
    remoteNeonTouched: false,
    cloudflareD1Touched: false,
    businessDataImported: false,
    workerBindingsChanged: false,
    productionCutoverAuthorized: false,
  }
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log('W06_MODERATION_NEON_ENTRY_POSTGRES18_REPORT ' + JSON.stringify(report))
}

if (failure) throw failure
if (!passed || !checks.disposableDatabaseDropped) {
  throw new Error('W06 Neon Worker entrypoint PostgreSQL 18 rehearsal incomplete: ' + JSON.stringify(checks))
}
console.log('W06_MODERATION_NEON_ENTRY_POSTGRES18_RUNTIME_PASS')
