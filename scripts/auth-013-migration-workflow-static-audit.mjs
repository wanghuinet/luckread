import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

// The historical AUTH-013 remote D1 mutation workflows were retired after
// W02 moved its account-state and publication-journal stores to Neon.
// Keep this static guard so the obsolete remote D1 execution paths cannot be
// reintroduced accidentally. PostgreSQL schema/rehearsal workflows are owned
// by the Neon migration toolchain and are intentionally unaffected.
const retiredWorkflows = [
  '.github/workflows/auth-013-account-state-migration.yml',
  '.github/workflows/auth-013-publication-journal-migration.yml',
]

const present = retiredWorkflows.filter((file) => fs.existsSync(path.join(root, file)))
if (present.length) {
  throw new Error(`retired remote D1 migration workflow(s) must not be restored: ${present.join(', ')}`)
}

console.log(JSON.stringify({
  AUTH_013_REMOTE_D1_MIGRATION_WORKFLOWS: 'RETIRED',
  retiredWorkflowCount: retiredWorkflows.length,
  productionMutationExecuted: false,
}, null, 2))
