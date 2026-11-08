import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  gitBlobSha1,
  verifyD104SharedRunnerReview,
} from './review-d1-04-shared-runner-independent.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const readSource = (relativePath) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
const reviewPath = 'contracts/database/neon-d1-04-shared-runner-independent-review.v1.json'

function overrideSource(pathToChange, mutate, updatePin = true) {
  const original = readSource(pathToChange)
  const changed = mutate(original)
  const review = JSON.parse(readSource(reviewPath))
  if (updatePin) {
    const pin = review.review.reviewedSourcePins.find((item) => item.path === pathToChange)
    assert.ok(pin, 'changed source must be pinned by the independent review contract')
    pin.gitBlobSha1 = gitBlobSha1(changed)
  }
  const overrides = new Map([
    [pathToChange, changed],
    [reviewPath, JSON.stringify(review)],
  ])
  return (relativePath) => overrides.has(relativePath)
    ? overrides.get(relativePath)
    : readSource(relativePath)
}

test('independently verifies W07 D1-04 owners, seven source migrations, six PG artifacts and PG18 evidence', () => {
  const result = verifyD104SharedRunnerReview({ readSource })
  assert.equal(result.status, 'D1_04_SHARED_RUNNER_INDEPENDENT_LOCAL_REVIEW_PASS')
  assert.deepEqual(result.physicalTablesByWorker, { W07: 15 })
  assert.deepEqual(result.catalog, {
    tables: 15,
    explicitIndexes: 31,
    finalTriggers: 72,
    triggerFunctions: 6,
    foreignKeys: 0,
    controlSeedRows: 1,
    businessRows: 0,
  })
  assert.deepEqual(result.triggerReplacement.dropped, [{
    name: 'payment_provider_events_terminal_immutable',
    migration: 6,
  }])
  assert.deepEqual(result.triggerReplacement.recreated, [{
    name: 'payment_provider_events_terminal_immutable',
    migration: 6,
  }])
  assert.equal(result.safety.remoteApplyReady, false)
})

test('fails closed if D1-04 shared manifest enables remote apply', () => {
  const manifestPath = 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => {
    const manifest = JSON.parse(text)
    manifest.remoteApplyReady = true
    return JSON.stringify(manifest)
  })
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /manifest target, local rehearsal, empty-business-data or remote-apply restrictions drifted/,
  )
})

test('fails closed if any D1-04 ledger entry is attributed to another Worker', () => {
  const manifestPath = 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => {
    const manifest = JSON.parse(text)
    manifest.entries[2].ownerWorker = 'W10'
    return JSON.stringify(manifest)
  })
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /ordered W07 schema\/ledger owner mapping drifted/,
  )
})

test('fails closed if W07 D1_04 runtime binding is renamed or retargeted', () => {
  const wranglerPath = 'workers/W07-subscription-commerce/wrangler.jsonc'
  const source = overrideSource(wranglerPath, (text) => {
    const wrangler = JSON.parse(text)
    const binding = wrangler.d1_databases.find((row) => row.binding === 'D1_04')
    binding.database_name = 'luckread_finance'
    return JSON.stringify(wrangler)
  })
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /W07 D1_04 binding must preserve/,
  )
})

test('fails closed if the PAY-004 scheduler seed values drift in the manifest', () => {
  const manifestPath = 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => {
    const manifest = JSON.parse(text)
    manifest.seedRows[0].rows[0].state_id = 'other-scheduler'
    return JSON.stringify(manifest)
  })
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /PAY-004 scheduler control seed must match its exact W07 contract row/,
  )
})

test('fails closed if an artifact adds another INSERT beyond the one scheduler control row', () => {
  const artifactPath = 'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0006_w07_d1_04_payment_method_revocation.sql'
  const source = overrideSource(artifactPath, (text) =>
    text + "\nINSERT INTO payment_method_revocation_requests(request_id) VALUES ('unapproved');\n",
  )
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /only the PAY-004 scheduler control metadata row may be inserted/,
  )
})

test('fails closed if the payment-provider trigger replacement DROP is removed', () => {
  const artifactPath = 'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0006_w07_d1_04_payment_method_revocation.sql'
  const source = overrideSource(artifactPath, (text) =>
    text.replace(
      'DROP TRIGGER IF EXISTS payment_provider_events_terminal_immutable ON payment_provider_events;',
      '-- removed unapproved trigger drop',
    ),
  )
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /final SQL catalog differs/,
  )
})

test('fails closed if a cross-domain foreign key is added', () => {
  const artifactPath = 'workers/W07-subscription-commerce/src/neon-postgres-migrations-d1-04/0006_w07_d1_04_payment_method_revocation.sql'
  const source = overrideSource(artifactPath, (text) =>
    text.replace(
      'request_id TEXT PRIMARY KEY NOT NULL',
      'request_id TEXT PRIMARY KEY NOT NULL REFERENCES public.users(user_id)',
    ),
  )
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /must not create any foreign keys/,
  )
})

test('fails closed on a reviewed source Git blob mismatch', () => {
  const manifestPath = 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'
  const source = overrideSource(manifestPath, (text) => text + '\n', false)
  assert.throws(
    () => verifyD104SharedRunnerReview({ readSource: source }),
    /reviewed source drifted/,
  )
})
