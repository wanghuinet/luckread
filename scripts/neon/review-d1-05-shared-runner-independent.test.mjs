import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  gitBlobSha1,
  verifyD105SharedRunnerReview,
} from './review-d1-05-shared-runner-independent.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readSource = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const reviewPath = 'contracts/database/neon-d1-05-shared-runner-independent-review.v1.json'
const artifactPath = 'workers/W11-growth-campaign-analytics-operations/src/neon-postgres-migrations-d1-05/0001_w11_d1_05_analytics_schema.sql'
const templatePath = 'workers/W11-growth-campaign-analytics-operations/scripts/neon/templates/d1-05-w11-analytics-postgres.sql'

function overrideSources(changes, updatePins = true) {
  const review = JSON.parse(readSource(reviewPath))
  const overrides = new Map()
  for (const [relativePath, mutate] of changes) {
    const changed = mutate(readSource(relativePath))
    overrides.set(relativePath,changed)
    if (updatePins) {
      const pin = review.review.reviewedSourcePins.find((item) => item.path === relativePath)
      assert.ok(pin, 'changed source must be pinned by the independent review contract')
      pin.gitBlobSha1 = gitBlobSha1(changed)
    }
  }
  if (updatePins) overrides.set(reviewPath,JSON.stringify(review))
  return (relativePath) => overrides.has(relativePath)
    ? overrides.get(relativePath)
    : readSource(relativePath)
}

test('independently verifies W11-only D1-05 ownership, four sources, six tables and PG18 evidence', () => {
  const result = verifyD105SharedRunnerReview({readSource})
  assert.equal(result.status,'D1_05_SHARED_RUNNER_INDEPENDENT_REVIEW_PASS_ADMISSION_BLOCKED')
  assert.equal(result.reviewedSources,15)
  assert.equal(result.sourceMigrations,4)
  assert.deepEqual(result.physicalTables,[
    'analytics_content_hourly',
    'analytics_creator_hourly',
    'analytics_event_dedupe',
    'analytics_projection_rebuild_state',
    'analytics_reconciliation_status',
    'analytics_rollup_watermark',
  ])
  assert.deepEqual(result.catalog,{
    tables:6,
    explicitIndexes:8,
    triggers:0,
    triggerFunctions:0,
    foreignKeys:0,
    controlSeedRows:0,
    businessRows:0,
    utcTimeTextColumnsWithBinaryCollation:15,
  })
  assert.equal(result.privacy.creatorIdPersisted,true)
  assert.equal(result.privacy.creatorIdPurposePolicyAdmitted,false)
  assert.equal(result.safety.remoteApplyReady,false)
})

test('fails closed if the D1-05 manifest enables remote apply', () => {
  const source = overrideSources([[
    'contracts/database/neon-d1-05-shared-migration-manifest.v1.json',
    (text) => {
      const manifest = JSON.parse(text)
      manifest.remoteApplyReady = true
      return JSON.stringify(manifest)
    },
  ]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /D1-05 manifest must remain local-only/,
  )
})

test('fails closed if W11 gains an unapproved D1-03 runtime binding', () => {
  const source = overrideSources([[
    'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
    (text) => {
      const wrangler = JSON.parse(text)
      wrangler.d1_databases.push({
        binding:'D1_03',
        database_name:'secondary',
        database_id:'bda1d247-a371-4244-91ae-aef96034db7f',
        migrations_dir:'migrations-d1-03',
      })
      return JSON.stringify(wrangler)
    },
  ]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /W11 must retain exactly its existing D1_05 binding/,
  )
})

test('fails closed if direct actor, visitor or session identifiers are added to analytics persistence', () => {
  const mutate = (text) => text.replace(
    '  actor_type TEXT NOT NULL',
    '  actor_id TEXT,\\n  actor_type TEXT NOT NULL',
  )
  const source = overrideSources([[artifactPath,mutate],[templatePath,mutate]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /must not persist direct identity\/session IDs/,
  )
})

test('fails closed if W11 D1-03 Campaign/GrowthOperation business tables are inferred into D1-05', () => {
  const mutate = (text) => text.replace(
    '\\nCOMMIT;',
    '\\nCREATE TABLE campaigns (campaign_id TEXT PRIMARY KEY NOT NULL);\\nCOMMIT;',
  )
  const source = overrideSources([[artifactPath,mutate],[templatePath,mutate]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /exactly its six analytics projection tables/,
  )
})

test('fails closed if a cross-domain foreign key is introduced', () => {
  const mutate = (text) => text.replace(
    '\\nCOMMIT;',
    '\\nALTER TABLE analytics_event_dedupe ADD CONSTRAINT bad_owner_ref FOREIGN KEY (content_id) REFERENCES users(id);\\nCOMMIT;',
  )
  const source = overrideSources([[artifactPath,mutate],[templatePath,mutate]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /no triggers, functions, foreign keys or seed inserts/,
  )
})

test('fails closed if missing retention, deletion or consent blockers are removed', () => {
  const source = overrideSources([[
    'contracts/database/neon-d1-05-shared-migration-manifest.v1.json',
    (text) => {
      const manifest = JSON.parse(text)
      manifest.remoteApplyBlockers = [
        'Independent release review remains required.',
      ]
      return JSON.stringify(manifest)
    },
  ]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /must retain retention, deletion and consent remote-admission blockers/,
  )
})

test('fails closed if UTC text ordering loses one COLLATE C column', () => {
  const mutate = (text) => text.replace(
    'occurred_at TEXT COLLATE "C"',
    'occurred_at TEXT',
  )
  const source = overrideSources([[artifactPath,mutate],[templatePath,mutate]])
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /must retain COLLATE C on all 15 UTC time-text columns/,
  )
})

test('fails closed when a reviewed D1 source migration Git blob drifts', () => {
  const sourcePath = 'workers/W11-growth-campaign-analytics-operations/migrations/0001_analytics_projection.sql'
  const source = overrideSources([[
    sourcePath,
    (text) => text + '\\n-- source drift\\n',
  ]],false)
  assert.throws(
    () => verifyD105SharedRunnerReview({readSource:source}),
    /reviewed source drifted/,
  )
})
