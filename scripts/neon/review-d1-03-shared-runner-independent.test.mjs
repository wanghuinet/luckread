import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  gitBlobSha1,
  verifyD103SharedRunnerReview,
} from './review-d1-03-shared-runner-independent.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readSource = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const reviewPath = 'contracts/database/neon-d1-03-shared-runner-independent-review.v1.json'

function overrideSource(pathToChange, makeContent) {
  const original = readSource(pathToChange)
  const changed = makeContent(original)
  const review = JSON.parse(readSource(reviewPath))
  const pin = review.review.reviewedSourcePins.find((item) => item.path === pathToChange)
  assert.ok(pin, 'changed source must be pinned by the independent review contract')
  pin.gitBlobSha1 = gitBlobSha1(changed)
  const overrides = new Map([
    [pathToChange, changed],
    [reviewPath, JSON.stringify(review)],
  ])
  return (relativePath) => overrides.has(relativePath)
    ? overrides.get(relativePath)
    : readSource(relativePath)
}

test('independently verifies D1-03 W06/W09/W10 ownership, SQL inventory and PG18 evidence', () => {
  const result = verifyD103SharedRunnerReview({ readSource })
  assert.equal(result.status, 'D1_03_SHARED_RUNNER_INDEPENDENT_LOCAL_REVIEW_PASS')
  assert.deepEqual(result.physicalTablesByWorker, { W06: 7, W09: 2, W10: 6 })
  assert.deepEqual(result.catalog, {
    tables: 15,
    explicitIndexes: 22,
    triggers: 2,
    triggerFunctions: 1,
    sameDomainForeignKeys: 2,
    businessRows: 0,
  })
  assert.equal(result.safety.remoteApplyReady, false)
})

test('fails closed if D1-03 shared manifest enables remote apply', () => {
  const manifestPath = 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => {
    const manifest = JSON.parse(text)
    manifest.remoteApplyReady = true
    return JSON.stringify(manifest)
  })
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /manifest target, empty-data and remote-apply restrictions drifted/,
  )
})

test('fails closed if W10 is promoted from logical owner to shared-ledger owner', () => {
  const manifestPath = 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => {
    const manifest = JSON.parse(text)
    manifest.entries[2].ownerWorker = 'W10'
    manifest.entries[2].migrationConfigOwner = 'W10'
    return JSON.stringify(manifest)
  })
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /ordered migration\/ledger owner mapping drifted/,
  )
})

test('fails closed if W10 receives a D1-03 runtime binding before separate admission', () => {
  const wranglerPath = 'workers/W10-async/wrangler.jsonc'
  const source = overrideSource(wranglerPath, (text) => {
    const wrangler = JSON.parse(text)
    wrangler.d1_databases = [{
      binding: 'D1_03',
      database_name: 'secondary',
      database_id: 'bda1d247-a371-4244-91ae-aef96034db7f',
      migrations_dir: 'migrations-d1-03',
    }]
    return JSON.stringify(wrangler)
  })
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /W10 D1-03 runtime binding is not admitted/,
  )
})

test('fails closed if Appeal is added to the admitted W06 physical artifact', () => {
  const artifactPath = 'workers/W06-governance/src/neon-postgres-migrations/0001_w06_d1_03_moderation_schema.sql'
  const source = overrideSource(artifactPath, (text) =>
    text + '\nCREATE TABLE appeals (appeal_id TEXT PRIMARY KEY NOT NULL);\n')
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /W06 PostgreSQL artifact tables do not match/,
  )
})

test('fails closed if Campaign/GrowthOperation are promoted into D1-03 migrations', () => {
  const manifestPath = 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => {
    const manifest = JSON.parse(text)
    manifest.entries.push({
      migrationId: 'd1-03-w11-campaigns',
      order: 400,
      ownerWorker: 'W11',
      logicalOwnerWorker: 'W11',
      kind: 'POSTGRESQL_SQL',
      artifactPaths: ['workers/W11-growth-campaign-analytics-operations/src/neon-postgres-migrations-d1-03/0001_campaigns.sql'],
      dependsOn: ['d1-03-w10-async-execution-schema-v1'],
      schemaContract: 'contracts/database/neon-d1-03-w11-campaign-schema.v1.json',
      sourceMigrations: ['workers/W11-growth-campaign-analytics-operations/migrations-d1-03/0001_campaigns.sql'],
    })
    return JSON.stringify(manifest)
  })
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /exactly the three admitted W06\/W09\/W10 schema entries/,
  )
})

test('fails closed if W05 NotificationPushEndpoint delegation is broadened', () => {
  const boundaryPath = 'contracts/transport/d1-03-entity-owner-boundary.v1.json'
  const source = overrideSource(boundaryPath, (text) => {
    const boundary = JSON.parse(text)
    boundary.scopedDelegations.NotificationPushEndpoint.allowedOperations.push(
      'DELETE /v1/push/endpoints',
    )
    return JSON.stringify(boundary)
  })
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /W05 NotificationPushEndpoint delegation must remain narrow/,
  )
})

test('fails closed on a reviewed source blob mismatch', () => {
  const manifestPath = 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json'
  const overrides = new Map([
    [manifestPath, readSource(manifestPath) + '\n'],
  ])
  const source = (relativePath) => overrides.has(relativePath)
    ? overrides.get(relativePath)
    : readSource(relativePath)
  assert.throws(
    () => verifyD103SharedRunnerReview({ readSource: source }),
    /reviewed source drifted/,
  )
})
