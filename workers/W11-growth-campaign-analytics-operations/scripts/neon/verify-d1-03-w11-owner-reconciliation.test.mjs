import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyW11D103OwnerReconciliation } from './verify-d1-03-w11-owner-reconciliation.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const readSource = (relativePath) => {
  try {
    return readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
  } catch {
    return null
  }
}

function readWithOverrides(overrides) {
  return (relativePath) => Object.hasOwn(overrides, relativePath)
    ? overrides[relativePath]
    : readSource(relativePath)
}

function jsonOverride(pathName, mutate) {
  const value = JSON.parse(readSource(pathName))
  mutate(value)
  return JSON.stringify(value)
}

test('reconciles the frozen T22 W11 owner set without admitting physical D1-03 tables', () => {
  const result = verifyW11D103OwnerReconciliation({ readSource })
  assert.equal(result.logicalOwnerEntities, 2)
  assert.deepEqual(result.admittedPhysicalSchemaEntities, [])
  assert.deepEqual(result.deferredPhysicalSchemaEntities, ['Campaign', 'GrowthOperation'])
  assert.equal(result.d1_05Task, 'T23')
  assert.equal(result.d1_05AnalyticsMigrationFiles, 4)
  assert.equal(result.d1_05AnalyticsTableDefinitions, 8)
  assert.equal(result.d1_03BindingPresent, false)
  assert.equal(result.unclassifiedEntities, 0)
  assert.equal(result.inventedTables, 0)
  assert.equal(result.remoteNeonDdlExecuted, false)
})

test('fails closed when a W11 D1-03 logical owner is omitted from the manifest', () => {
  const override = jsonOverride(
    'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json',
    (value) => { value.logicalOwnerEntities = ['Campaign'] },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json': override,
    }),
  }), /logical owner inventory must be exact/)
})

test('fails closed if the frozen D1-03 owner boundary changes without reconciliation', () => {
  const override = jsonOverride(
    'contracts/transport/d1-03-entity-owner-boundary.v1.json',
    (value) => { value.owners.W11.push('UnclassifiedGrowthEntity') },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/transport/d1-03-entity-owner-boundary.v1.json': override,
    }),
  }), /must assign Campaign and GrowthOperation to W11 exactly once/)
})

test('fails closed if T22 or T23 is remapped across the D1-03 and D1-05 boundary', () => {
  const override = readSource('docs/02-FINAL-MAPPING-v1.0.md')
    .replace('| T22 | W11 | D1-03 campaign/growth operations |',
      '| T22 | W11 | D1-05 analytics-only derived data | MAPPED |')
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'docs/02-FINAL-MAPPING-v1.0.md': override,
    }),
  }), /must keep T22 in D1-03 and T23 in D1-05/)
})

test('fails closed if Campaign is falsely promoted into the D1-03 physical schema', () => {
  const override = jsonOverride(
    'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json',
    (value) => {
      value.admittedPhysicalSchemaEntities = ['Campaign']
      value.deferredPhysicalSchemaEntities =
        value.deferredPhysicalSchemaEntities.filter((entry) => entry.entity !== 'Campaign')
    },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json': override,
    }),
  }), /no W11 D1-03 physical schema may be admitted/)
})

test('fails closed if W11 is granted a D1-03 Wrangler binding without admission', () => {
  const override = jsonOverride(
    'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
    (value) => {
      value.d1_databases.push({
        binding: 'D1_03',
        database_name: 'secondary',
        database_id: 'bda1d247-a371-4244-91ae-aef96034db7f',
      })
    },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc': override,
    }),
  }), /single D1_05 analytics binding/)
})

test('fails closed if the W11 runtime type exposes D1-03', () => {
  const override = readSource('workers/W11-growth-campaign-analytics-operations/src/worker.ts')
    .replace('  D1_05: W11AnalyticsDatabase',
      '  D1_05: W11AnalyticsDatabase\n  D1_03: D1Database')
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'workers/W11-growth-campaign-analytics-operations/src/worker.ts': override,
    }),
  }), /runtime environment must expose D1_05 only/)
})

test('fails closed if a W11 D1-05 migration creates a non-analytics table', () => {
  const pathName =
    'workers/W11-growth-campaign-analytics-operations/migrations/0002_analytics_projection_rebuild_state.sql'
  const override = readSource(pathName)
    .replace('CREATE TABLE IF NOT EXISTS analytics_projection_rebuild_state',
      'CREATE TABLE IF NOT EXISTS campaign')
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({ [pathName]: override }),
  }), /created a non-analytics table/)
})

test('fails closed if bootstrap admits W11 analytics migrations as D1-03 sources', () => {
  const override = jsonOverride(
    'contracts/database/neon-five-domain-schema-bootstrap.v1.json',
    (value) => {
      const d1_03 = value.domains.find((domain) => domain.domainId === 'D1-03')
      d1_03.schemaSources.push(
        'workers/W11-growth-campaign-analytics-operations/migrations',
      )
    },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-five-domain-schema-bootstrap.v1.json': override,
    }),
  }), /must not admit W11 analytics migrations as D1-03 schema sources/)
})

test('fails closed when a deferred W11 entity claims unadmitted governance/source evidence', () => {
  const override = jsonOverride(
    'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json',
    (value) => {
      value.deferredPhysicalSchemaEntities[0].admissionEvidence.governanceAccessContract =
        'contracts/transport/w11-d1-03-governance-access.v1.json'
    },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json': override,
    }),
  }), /requires a concrete reason, prerequisites and null source-admission evidence/)
})

test('fails closed if remote DDL or runtime changes are claimed by this inventory-only slice', () => {
  const override = jsonOverride(
    'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json',
    (value) => { value.safety.remoteNeonDdlExecuted = true },
  )
  assert.throws(() => verifyW11D103OwnerReconciliation({
    readSource: readWithOverrides({
      'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json': override,
    }),
  }), /must remain inventory-only with no remote or runtime mutation/)
})
