import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-01-migration-manifest.v1.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-schema-migration-ledger.v1.json'), 'utf8'))
const runnerPath = resolve(root, 'scripts/neon/run-schema-migrations.mjs')
const ready = manifest.remoteApplyReady === true &&
  ledger.remoteApplyReady === true &&
  manifest.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
  ledger.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
  existsSync(runnerPath)

if (process.argv.includes('--deny-owner-bypass')) {
  throw new Error(
    'Owner-specific Neon schema apply is permanently disabled. ' +
    'Use the reviewed shared schema migration runner workflow; never invoke an owner-only remote apply workflow.'
  )
}
if (process.argv.includes('--expect-blocked')) {
  if (ready) throw new Error('Shared runner readiness unexpectedly became true; update this blocked-state CI assertion in the executor release PR.')
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
