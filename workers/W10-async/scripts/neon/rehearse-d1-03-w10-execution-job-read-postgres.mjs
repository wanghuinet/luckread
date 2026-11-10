import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { createPostgresW10T16MembershipRenewalJobReadStore } from '../../src/execution-job-read-store-postgres.ts'

const requireFromW02 = createRequire(new URL('../../../W02-identity/package.json', import.meta.url))
const { Pool } = requireFromW02('pg')

const connectionString = process.env.D1_03_W10_LOCAL_DATABASE_URL
if (!connectionString) throw new Error('D1_03_W10_LOCAL_DATABASE_URL is required')

const target = new URL(connectionString)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_d1_03_w10_rehearsal'
) {
  throw new Error('Refusing to run W10 job-read rehearsal outside disposable local PostgreSQL luckread_d1_03_w10_rehearsal')
}

const marker = 'w10-job-read-' + randomUUID()
const reportPath = process.env.D1_03_W10_JOB_READ_REPORT ||
  'artifacts/neon/d1-03-w10-execution-job-read-postflight.json'
const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresW10T16MembershipRenewalJobReadStore(pool)
let runtimePassed = false
const checks = {
  operationIdLookupPreserved: false,
  ownerWorkerScopePreserved: false,
  ownerTaskScopePreserved: false,
  stateFilterPreserved: false,
  stableUpdatedAtOperationIdOrdering: false,
  keysetCursorPreservesMicroseconds: false,
  nextPageHasNoDuplicates: false,
  safeProjectionExcludesActorSubjectIds: false,
  cleanupVerified: false,
}

const insertJob = async (input) => {
  await pool.query(
    `INSERT INTO jobs (
       job_id,operation_id,operation_type,owner_worker,owner_task_id,
       resource_type,resource_id,actor_id,subject_id,scope,state,
       progress_current,progress_total,created_at,started_at,updated_at,
       completed_at,expires_at,idempotency_key,correlation_id,request_id,
       trace_id,error_code,result_ref
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,NULL,
       $12::timestamptz,NULL,$13::timestamptz,NULL,$14::timestamptz,
       $15,$16,$17,$18,NULL,NULL
     )`,
    [
      input.jobId,
      input.operationId,
      'membership-renewal-scheduled-batch',
      input.ownerWorker,
      input.ownerTaskId,
      'MembershipRenewalWorkflow',
      input.resourceId,
      marker + '-synthetic-actor',
      marker + '-synthetic-subject',
      'w07:t16:membership-renewal',
      input.state,
      input.createdAt,
      input.updatedAt,
      '2026-12-10T00:00:00.000000Z',
      'idem-' + input.operationId,
      'corr-' + input.operationId,
      'req-' + input.operationId,
      'trace-' + input.operationId,
    ],
  )
}

try {
  const opZ = marker + '-op-z'
  const opY = marker + '-op-y'
  const opB = marker + '-op-b'
  const opA = marker + '-op-a'
  const opOtherTask = marker + '-op-other-task'
  const opOtherOwner = marker + '-op-other-owner'
  const opFailed = marker + '-op-failed'

  await insertJob({
    operationId: opZ,
    jobId: marker + '-job-z',
    ownerWorker: 'W07',
    ownerTaskId: 'T16',
    resourceId: marker + '-workflow-z',
    state: 'RUNNING',
    createdAt: '2026-11-10T04:02:00.000456Z',
    updatedAt: '2026-11-10T04:02:00.000456Z',
  })
  await insertJob({
    operationId: opY,
    jobId: marker + '-job-y',
    ownerWorker: 'W07',
    ownerTaskId: 'T16',
    resourceId: marker + '-workflow-y',
    state: 'SUCCEEDED',
    createdAt: '2026-11-10T04:02:00.000456Z',
    updatedAt: '2026-11-10T04:02:00.000456Z',
  })
  await insertJob({
    operationId: opB,
    jobId: marker + '-job-b',
    ownerWorker: 'W07',
    ownerTaskId: 'T16',
    resourceId: marker + '-workflow-b',
    state: 'RUNNING',
    createdAt: '2026-11-10T04:02:00.000123Z',
    updatedAt: '2026-11-10T04:02:00.000123Z',
  })
  await insertJob({
    operationId: opA,
    jobId: marker + '-job-a',
    ownerWorker: 'W07',
    ownerTaskId: 'T16',
    resourceId: marker + '-workflow-a',
    state: 'SUCCEEDED',
    createdAt: '2026-11-10T04:02:00.000050Z',
    updatedAt: '2026-11-10T04:02:00.000050Z',
  })
  await insertJob({
    operationId: opOtherTask,
    jobId: marker + '-job-other-task',
    ownerWorker: 'W07',
    ownerTaskId: 'T17',
    resourceId: marker + '-workflow-other-task',
    state: 'RUNNING',
    createdAt: '2026-11-10T04:02:00.000900Z',
    updatedAt: '2026-11-10T04:02:00.000900Z',
  })
  await insertJob({
    operationId: opOtherOwner,
    jobId: marker + '-job-other-owner',
    ownerWorker: 'W06',
    ownerTaskId: 'T21',
    resourceId: marker + '-workflow-other-owner',
    state: 'RUNNING',
    createdAt: '2026-11-10T04:02:00.000800Z',
    updatedAt: '2026-11-10T04:02:00.000800Z',
  })
  await insertJob({
    operationId: opFailed,
    jobId: marker + '-job-failed',
    ownerWorker: 'W07',
    ownerTaskId: 'T16',
    resourceId: marker + '-workflow-failed',
    state: 'FAILED',
    createdAt: '2026-11-10T04:02:00.000700Z',
    updatedAt: '2026-11-10T04:02:00.000700Z',
  })

  const byOperation = await store.getByOperationId(opZ)
  assert.equal(byOperation?.operation_id, opZ)
  assert.equal(byOperation?.owner_worker, 'W07')
  assert.equal(byOperation?.owner_task_id, 'T16')
  assert.equal(Object.hasOwn(byOperation ?? {}, 'actor_id'), false)
  assert.equal(Object.hasOwn(byOperation ?? {}, 'subject_id'), false)
  checks.safeProjectionExcludesActorSubjectIds =
    !Object.hasOwn(byOperation ?? {}, 'actor_id') && !Object.hasOwn(byOperation ?? {}, 'subject_id')
  checks.operationIdLookupPreserved = byOperation?.operation_id === opZ

  const firstPage = await store.list({
    states: ['RUNNING', 'SUCCEEDED'],
    limit: 3,
  })
  assert.deepEqual(firstPage.map((row) => row.operation_id), [opZ, opY, opB])
  checks.ownerWorkerScopePreserved = firstPage.every((row) => row.owner_worker === 'W07')
  checks.ownerTaskScopePreserved = firstPage.every((row) => row.owner_task_id === 'T16')
  checks.stateFilterPreserved = firstPage.every((row) => row.state === 'RUNNING' || row.state === 'SUCCEEDED')
  checks.stableUpdatedAtOperationIdOrdering =
    firstPage[0]?.operation_id === opZ && firstPage[1]?.operation_id === opY

  const last = firstPage.at(-1)
  assert.ok(last)
  const secondPage = await store.list({
    states: ['RUNNING', 'SUCCEEDED'],
    cursor: { updatedAt: last.updated_at, operationId: last.operation_id },
    limit: 3,
  })
  assert.deepEqual(secondPage.map((row) => row.operation_id), [opA])
  checks.keysetCursorPreservesMicroseconds =
    last.updated_at === '2026-11-10T04:02:00.000123Z' &&
    secondPage[0]?.updated_at === '2026-11-10T04:02:00.000050Z'

  const allIds = [...firstPage, ...secondPage].map((row) => row.operation_id)
  assert.deepEqual(allIds, [opZ, opY, opB, opA])
  assert.equal(new Set(allIds).size, 4)
  checks.nextPageHasNoDuplicates = new Set(allIds).size === 4
  runtimePassed = true
} finally {
  try {
    await pool.query(
      'DELETE FROM jobs WHERE job_id LIKE $1 OR operation_id LIKE $1',
      [marker + '%'],
    )
    const residual = await pool.query(
      'SELECT count(*)::int AS rows FROM jobs WHERE job_id LIKE $1 OR operation_id LIKE $1',
      [marker + '%'],
    )
    const remainingRows = residual.rows[0]?.rows ?? -1
    assert.equal(remainingRows, 0, 'All synthetic W10 jobs must be removed')
    checks.cleanupVerified = true

    const report = {
      status: runtimePassed
        ? 'W10_EXECUTION_JOB_READ_POSTGRES_RUNTIME_PASS'
        : 'W10_EXECUTION_JOB_READ_POSTGRES_RUNTIME_FAILED',
      postgresDatabase: target.pathname.slice(1),
      ...checks,
      remainingFixtureRows: remainingRows,
      remoteNeonTouched: false,
      cloudflareD1Touched: false,
      businessDataImported: false,
      workerBindingsChanged: false,
      productionCutoverAuthorized: false,
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
    console.log(
      (runtimePassed ? 'W10_EXECUTION_JOB_READ_POSTGRES_RUNTIME_PASS ' : 'W10_EXECUTION_JOB_READ_POSTGRES_RUNTIME_FAILED ') +
      JSON.stringify(report),
    )
  } finally {
    await pool.end()
  }
}
