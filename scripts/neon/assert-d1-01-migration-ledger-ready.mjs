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

if (process.argv.includes('--expect-blocked')) {
  if (ready) throw new Error('D1-01 remote apply is unexpectedly enabled before explicit release review')
  console.log('D1_01_REMOTE_APPLY_BLOCKED_RUNNER_NOT_IMPLEMENTED')
  process.exit(0)
}
if (!ready) {
  throw new Error(
    'D1-01 remote Neon apply is blocked: the shared migration runner is not implemented, reviewed and enabled. ' +
    'Do not invoke an owner-specific remote schema workflow.'
  )
}
console.log('D1_01_SHARED_MIGRATION_RUNNER_READY')
