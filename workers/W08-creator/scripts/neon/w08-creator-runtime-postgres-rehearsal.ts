import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { Pool } from 'pg'

import { createPostgresW08CreatorStore } from '../../src/creator-store.js'

const connectionString = process.env.W08_RUNTIME_DATABASE_URL
if (!connectionString) throw new Error('W08_RUNTIME_DATABASE_URL is required')
const target = new URL(connectionString)
if (
  !new Set(['127.0.0.1', 'localhost', 'postgres']).has(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing W08 rehearsal outside disposable local luckread_schema PostgreSQL')
}

const pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5_000 })
const store = createPostgresW08CreatorStore(pool)
const marker = randomUUID().replace(/-/g, '').slice(0, 16)
const now = new Date().toISOString()
const applicantOne = 'w08-runtime-' + marker + '-a'
const applicantTwo = 'w08-runtime-' + marker + '-b'
const reviewer = 'w08-runtime-' + marker + '-reviewer'
const applicationOne = 'w08-app-' + marker + '-a'
const applicationTwo = 'w08-app-' + marker + '-b'
const keyOne = 'w08-idem-' + marker + '-a'
const keyTwo = 'w08-idem-' + marker + '-b'
const decisionOne = 'w08-review-' + marker + '-a'
const decisionTwo = 'w08-review-' + marker + '-b'
const correlationId = 'w08-neon-runtime-' + marker
let cleanupVerified = false

try {
  await store.createApplication({
    applicationId: applicationOne,
    userId: applicantOne,
    creatorType: 'WRITER',
    statement: 'Disposable PostgreSQL 18 creator application rehearsal.',
    idempotencyKey: keyOne,
    correlationId,
    now,
  })

  const replay = await store.findApplicationByIdempotency(applicantOne, keyOne)
  assert.equal(replay?.application_id, applicationOne)
  assert.equal(replay?.status, 'PENDING')

  const ownApplication = await store.findOwnApplication(applicantOne)
  assert.equal(ownApplication?.application_id, applicationOne)
  assert.equal(ownApplication?.version, 1)

  const reviewQueue = await store.listReviewableApplications(reviewer, 50)
  assert.ok(reviewQueue.some((item) => item.application_id === applicationOne))

  const approved = await store.approveApplication({
    applicationId: applicationOne,
    applicantId: applicantOne,
    creatorType: 'WRITER',
    actorId: reviewer,
    idempotencyKey: decisionOne,
    reason: 'Disposable PostgreSQL 18 approval rehearsal.',
    expectedVersion: 1,
    correlationId,
    now,
  })
  assert.equal(approved, true)

  const afterApproval = await store.readApplication(applicationOne)
  assert.equal(afterApproval?.status, 'APPROVED')
  assert.equal(afterApproval?.grant_state, 'PENDING')
  assert.equal(afterApproval?.version, 2)

  const creator = await store.findCreatorByUser(applicantOne)
  assert.equal(creator?.application_id, applicationOne)
  assert.equal(creator?.status, 'PENDING_ROLE_GRANT')

  await store.completeCreatorGrant({
    applicationId: applicationOne,
    applicantId: applicantOne,
    creatorId: 'creator-' + applicationOne,
    actorId: reviewer,
    idempotencyKey: decisionOne,
    correlationId,
    now,
  })

  const afterGrant = await store.readApplication(applicationOne)
  assert.equal(afterGrant?.grant_state, 'GRANTED')
  assert.equal(afterGrant?.version, 3)
  const activeCreator = await store.findActiveCreator(applicantOne)
  assert.equal(activeCreator?.creator_id, 'creator-' + applicationOne)

  await store.createApplication({
    applicationId: applicationTwo,
    userId: applicantTwo,
    creatorType: 'ARTIST',
    statement: 'Disposable PostgreSQL 18 rejection rehearsal.',
    idempotencyKey: keyTwo,
    correlationId,
    now,
  })
  const rejected = await store.rejectApplication({
    applicationId: applicationTwo,
    applicantId: applicantTwo,
    creatorType: 'ARTIST',
    actorId: reviewer,
    idempotencyKey: decisionTwo,
    reason: 'Disposable PostgreSQL 18 rejection rehearsal.',
    expectedVersion: 1,
    correlationId,
    now,
  })
  assert.equal(rejected, true)
  const afterRejection = await store.readApplication(applicationTwo)
  assert.equal(afterRejection?.status, 'REJECTED')
  assert.equal(afterRejection?.grant_state, 'NOT_REQUESTED')
  assert.equal(await store.findCreatorByUser(applicantTwo), null)

  const audit = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM creator_authorization_audit WHERE subject_id = ANY($1::text[])',
    [[applicantOne, applicantTwo]],
  )
  assert.equal(Number(audit.rows[0]?.count), 5)

  const report = {
    schemaVersion: 1,
    rehearsal: 'W08_CREATOR_POSTGRES_RUNTIME',
    postgresDatabase: 'luckread_schema',
    applicationCreatedAndReplayed: true,
    approvalCompareAndSet: true,
    creatorGrantPendingToActive: true,
    rejectionCompareAndSet: true,
    auditRowsVerified: Number(audit.rows[0]?.count),
    productionMutationPerformed: false,
  }

  await pool.query(
    'DELETE FROM creator_authorization_audit WHERE subject_id = ANY($1::text[])',
    [[applicantOne, applicantTwo]],
  )
  await pool.query(
    'DELETE FROM creators WHERE user_id = ANY($1::text[]) OR application_id = ANY($2::text[])',
    [[applicantOne, applicantTwo], [applicationOne, applicationTwo]],
  )
  await pool.query(
    'DELETE FROM creator_applications WHERE application_id = ANY($1::text[])',
    [[applicationOne, applicationTwo]],
  )
  const remaining = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM creator_applications WHERE application_id = ANY($1::text[])',
    [[applicationOne, applicationTwo]],
  )
  assert.equal(Number(remaining.rows[0]?.count), 0)
  cleanupVerified = true

  const output = resolve(process.cwd(), 'artifacts/neon/w08-d1-01-creator-postgres-runtime-postflight.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, JSON.stringify({ ...report, syntheticRowsRemoved: cleanupVerified }, null, 2) + '\n', 'utf8')
  process.stdout.write('W08_CREATOR_POSTGRES_RUNTIME_REHEARSAL_PASS\n')
} finally {
  await pool.end()
}
