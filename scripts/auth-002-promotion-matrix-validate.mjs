import { existsSync, readFileSync } from 'node:fs'

const matrixPath = 'contracts/alignment/mapping-batches/AUTH-002-promotion-matrix.v1.json'
const fail = (message) => {
  console.error(`AUTH-002_PROMOTION_MATRIX_REJECTED: ${message}`)
  process.exit(1)
}

if (!existsSync(matrixPath)) fail(`missing matrix: ${matrixPath}`)
let matrix
try {
  matrix = JSON.parse(readFileSync(matrixPath, 'utf8'))
} catch {
  fail('matrix is not valid JSON')
}

if (matrix.featureId !== 'AUTH-002') fail('featureId must be AUTH-002')
if (matrix.entityId !== 'ENT-SESSION') fail('entityId must be ENT-SESSION')
if (matrix.failClosed !== true) fail('failClosed must be true')
if (matrix.currentDecision !== 'DO_NOT_PROMOTE') fail('currentDecision must remain DO_NOT_PROMOTE until all gates pass')

const requiredStates = {
  CONTRACT_CLOSED: 'PASS',
  GATE1_EXECUTED_AND_ACCEPTED: 'GATE1_PASS',
  GATE2_EXECUTED_AND_ACCEPTED: 'GATE2_PASS',
  MIGRATION_EXECUTED_AND_VERIFIED: 'PASS',
  RUNTIME_PERSISTENCE_VERIFIED: 'PASS',
  SECURITY_E2E_VERIFIED: 'PASS',
  CONCURRENCY_E2E_VERIFIED: 'PASS',
  EVIDENCE_REGISTERED: 'PASS',
  MAPPING0_VERIFIED: 'PASS',
  ENT_SESSION_VERIFIED: 'PASS',
  AUTH002_GREEN: 'PASS',
}

const gates = matrix.gates ?? {}
for (const [gate, requiredState] of Object.entries(requiredStates)) {
  if (!gates[gate] || typeof gates[gate] !== 'object') fail(`missing gate record: ${gate}`)
  if (gate !== 'CONTRACT_CLOSED' && gates[gate].current === 'PASS') fail(`${gate} cannot use generic PASS; use its explicit acceptance state`)
}

const promotionGateChecks = [
  ['GATE1_EXECUTED_AND_ACCEPTED', 'NOT_VERIFIED'],
  ['GATE2_EXECUTED_AND_ACCEPTED', 'NOT_EXECUTED'],
  ['MIGRATION_EXECUTED_AND_VERIFIED', 'NOT_VERIFIED'],
  ['RUNTIME_PERSISTENCE_VERIFIED', 'NOT_VERIFIED'],
  ['SECURITY_E2E_VERIFIED', 'NOT_VERIFIED'],
  ['CONCURRENCY_E2E_VERIFIED', 'NOT_VERIFIED'],
  ['EVIDENCE_REGISTERED', 'NOT_BOUND'],
  ['MAPPING0_VERIFIED', 'NOT_VERIFIED'],
  ['ENT_SESSION_VERIFIED', 'BLOCKED'],
  ['AUTH002_GREEN', 'BLOCKED'],
]

for (const [gate, expectedCurrent] of promotionGateChecks) {
  if (gates[gate].current !== expectedCurrent) fail(`${gate} current state drifted: expected ${expectedCurrent}, found ${gates[gate].current}`)
}

const requiredStopConditions = [
  'empty evidence registry',
  'documentation-only evidence',
  'stale commit evidence',
  'unresolved canonical DTO/entity/field reference',
  'unverified D1 schema',
  'unverified migration execution',
  'independent session identity',
  'raw credential persistence or evidence leakage',
  'revoked or expired session authorizes',
  'more than one successful successor from one refresh predecessor',
]
const stops = new Set((matrix.stopConditions ?? []).map((x) => String(x).toLowerCase()))
for (const condition of requiredStopConditions) {
  if (!stops.has(condition)) fail(`missing mandatory stop condition: ${condition}`)
}

console.log('AUTH-002_PROMOTION_MATRIX_VALIDATION_PASS')
console.log('Fail-closed promotion matrix structure, gate states, current decision, and mandatory stop conditions validated.')
console.log('This validator intentionally does not fabricate execution evidence or promote AUTH-002.')
