import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRemoteRunnerReview } from './remote-runner-review.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-01-migration-manifest.v1.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-schema-migration-ledger.v1.json'), 'utf8'))
const runnerPath = resolve(root, 'scripts/neon/run-schema-migrations.mjs')
const reviewRef = 'contracts/database/neon-d1-01-remote-runner-review.v1.json'
const review = validateRemoteRunnerReview({ root })
const manifestValidation = spawnSync(process.execPath, [
  resolve(root, 'scripts/neon/d1-01-migration-manifest.mjs'),
], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const domainReadiness = ledger.execution?.domainReadiness ?? {}
const expectedDomains = ['D1-01', 'D1-02', 'D1-03', 'D1-04', 'D1-05']
const d1Readiness = domainReadiness['D1-01']
const otherDomainsBlocked = expectedDomains
  .filter((domain) => domain !== 'D1-01')
  .every((domain) => domainReadiness[domain]?.runnerStatus === 'NOT_IMPLEMENTED' &&
    domainReadiness[domain]?.remoteApplyReady === false)
const ready = manifestValidation.status === 0 &&
  manifest.remoteApplyReady === true &&
  manifest.execution?.remoteApplyReady === true &&
  manifest.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
  ledger.remoteApplyReady === false &&
  ledger.execution?.remoteApplyReady === false &&
  ledger.execution?.runnerStatus === 'IMPLEMENTED_FOR_D1_01_ONLY' &&
  JSON.stringify(Object.keys(domainReadiness).sort()) === JSON.stringify(expectedDomains) &&
  d1Readiness?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
  d1Readiness?.remoteApplyReady === true &&
  manifest.execution?.reviewEvidenceRef === reviewRef &&
  d1Readiness?.reviewEvidenceRef === reviewRef &&
  otherDomainsBlocked &&
  existsSync(runnerPath) &&
  review.valid

if (process.argv.includes('--deny-owner-bypass')) {
  throw new Error(
    'Owner-specific Neon schema apply is permanently disabled. ' +
    'Use the reviewed shared schema migration runner workflow; never invoke an owner-only remote apply workflow.'
  )
}
if (process.argv.includes('--expect-blocked')) {
  if (ready) throw new Error('Shared runner readiness is now released; remove obsolete blocked-state assertions from downstream workflows.')
  console.log('D1_01_REMOTE_APPLY_BLOCKED_RUNNER_NOT_IMPLEMENTED')
  process.exit(0)
}
if (process.argv.includes('--assert-runner-ready')) {
  if (!ready) {
    throw new Error(
      'D1-01 remote Neon apply is blocked: shared runner implementation, review and explicit release enablement are incomplete.'
    )
  }
  console.log('D1_01_SHARED_MIGRATION_RUNNER_READY')
  process.exit(0)
}
throw new Error('Select an explicit guard mode: --deny-owner-bypass, --expect-blocked or --assert-runner-ready.')
