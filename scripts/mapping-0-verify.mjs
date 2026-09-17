#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const gates = [
  ['canonical-mapping-consolidation', 'scripts/consolidate-mapping-batches.mjs'],
  ['entity-catalog', 'scripts/entity-catalog-check.mjs'],
  ['entity-field-contract', 'scripts/entity-field-contract-check.mjs'],
  ['entity-field-schema', 'scripts/entity-field-schema-contract-check.mjs'],
  ['feature-entity-persistence', 'scripts/feature-entity-persistence-registry-check.mjs'],
]

const failures = []
for (const [name, script] of gates) {
  console.log(`\n=== Mapping 0 gate: ${name} ===`)
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
  if (result.error) {
    failures.push(`${name}: ${result.error.message}`)
    break
  }
  if (result.status !== 0) {
    failures.push(`${name}: exit ${result.status}`)
    break
  }
}

if (failures.length) {
  console.error('\nMAPPING_0_NOT_GREEN')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('\nMAPPING_0_GREEN')
