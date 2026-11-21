#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

// Mapping 0 is a pre-development structural/contract stage. Runtime and
// executable-evidence admission remain downstream gates and must not be used
// to manufacture a false Mapping 0 GREEN.
const gates = [
  ['mapping-0-structural', 'scripts/mapping-0-structural-gate.mjs'],
  ['entity-catalog', 'scripts/entity-catalog-check.mjs'],
  ['entity-field-contract', 'scripts/entity-field-contract-check.mjs'],
  ['entity-field-schema', 'scripts/entity-field-schema-contract-check.mjs'],
]

const failures = []
for (const [name, script] of gates) {
  console.log(`\n=== Mapping 0 gate: ${name} ===`)
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' })
  if (result.error) {
    failures.push(`${name}: ${result.error.message}`)
  } else if (result.status !== 0) {
    failures.push(`${name}: exit ${result.status}`)
  }
}

if (failures.length) {
  console.error('\nMAPPING_0_NOT_GREEN')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('\nMAPPING_0_GREEN')
console.log('Downstream implementation/runtime/evidence gates remain authoritative for later stages.')
