#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../../..')

const paths = {
  manifest: 'contracts/database/neon-d1-03-w11-owner-reconciliation.v1.json',
  ownerBoundary: 'contracts/transport/d1-03-entity-owner-boundary.v1.json',
  d1_05OwnerBoundary: 'contracts/transport/d1-05-analytics-owner-boundary.v1.json',
  domainMaster: 'docs/09-D1-DOMAIN-MASTER-v1.0.md',
  taskMapping: 'docs/02-FINAL-MAPPING-v1.0.md',
  w09SchemaContract: 'contracts/database/neon-d1-03-w09-platform-schema.v1.json',
  fiveDomainBootstrap: 'contracts/database/neon-five-domain-schema-bootstrap.v1.json',
  w11Readme: 'workers/W11-growth-campaign-analytics-operations/README.md',
  w11Wrangler: 'workers/W11-growth-campaign-analytics-operations/wrangler.jsonc',
  w11Worker: 'workers/W11-growth-campaign-analytics-operations/src/worker.ts',
}

const expectedEntities = ['Campaign', 'GrowthOperation']
const expectedAnalyticsMigrations = [
  'workers/W11-growth-campaign-analytics-operations/migrations/0001_analytics_projection.sql',
  'workers/W11-growth-campaign-analytics-operations/migrations/0002_analytics_projection_rebuild_state.sql',
  'workers/W11-growth-campaign-analytics-operations/migrations/0003_analytics_late_event_replay.sql',
  'workers/W11-growth-campaign-analytics-operations/migrations/0004_analytics_w01_client_telemetry.sql',
]

function required(readSource, relativePath) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') {
    throw new Error('Missing required W11 owner-reconciliation source: ' + relativePath)
  }
  return value
}

function parseJson(readSource, relativePath) {
  try {
    return JSON.parse(required(readSource, relativePath))
  } catch (error) {
    throw new Error('Invalid JSON source ' + relativePath + ': ' +
      (error instanceof Error ? error.message : String(error)))
  }
}

function sameSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function createdTableNames(sql) {
  return [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_]+)/gi)]
    .map((match) => match[1])
}

export function verifyW11D103OwnerReconciliation({
  readSource = (relativePath) => {
    try {
      return readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
    } catch {
      return null
    }
  },
  fileExists = (relativePath) => existsSync(path.join(repositoryRoot, relativePath)),
} = {}) {
  const manifest = parseJson(readSource, paths.manifest)
  const ownerBoundary = parseJson(readSource, paths.ownerBoundary)
  const d1_05OwnerBoundary = parseJson(readSource, paths.d1_05OwnerBoundary)
  const w09SchemaContract = parseJson(readSource, paths.w09SchemaContract)
  const bootstrap = parseJson(readSource, paths.fiveDomainBootstrap)
  const wrangler = parseJson(readSource, paths.w11Wrangler)
  const domainMaster = required(readSource, paths.domainMaster)
  const taskMapping = required(readSource, paths.taskMapping)
  const readme = required(readSource, paths.w11Readme)
  const worker = required(readSource, paths.w11Worker)

  if (
    manifest.status !== 'LOGICAL_OWNERS_RECONCILED_SCHEMA_ADMISSION_BLOCKED' ||
    manifest.scope?.domainId !== 'D1-03' ||
    manifest.scope?.worker !== 'W11' ||
    manifest.scope?.primaryTask !== 'T22'
  ) {
    throw new Error('W11 manifest must retain the blocked T22/D1-03 schema-admission status')
  }

  if (ownerBoundary.domain !== 'D1-03' ||
      !sameSet(ownerBoundary.owners?.W11 ?? [], expectedEntities)) {
    throw new Error('Canonical D1-03 owner boundary must assign Campaign and GrowthOperation to W11 exactly once')
  }

  for (const entity of expectedEntities) {
    const row = new RegExp('^\\|\\s*' + entity + '\\s*\\|\\s*W11\\s*\\|', 'm')
    if (!row.test(domainMaster)) {
      throw new Error('D1 Domain Master must retain W11 ownership for ' + entity)
    }
  }

  if (
    !/^\|\s*T22\s*\|\s*W11\s*\|\s*D1-03 campaign\/growth operations\s*\|\s*MAPPED\s*\|/m.test(taskMapping) ||
    !/^\|\s*T23\s*\|\s*W11\s*\|\s*D1-05 analytics-only derived data\s*\|\s*MAPPED\s*\|/m.test(taskMapping)
  ) {
    throw new Error('Canonical task mapping must keep T22 in D1-03 and T23 in D1-05')
  }

  if (!sameSet(manifest.logicalOwnerEntities ?? [], expectedEntities) ||
      !sameSet(manifest.admittedPhysicalSchemaEntities ?? [], [])) {
    throw new Error('W11 logical owner inventory must be exact and no W11 D1-03 physical schema may be admitted')
  }

  const deferred = manifest.deferredPhysicalSchemaEntities ?? []
  const deferredNames = deferred.map((entry) => entry?.entity)
  if (!sameSet(deferredNames, expectedEntities) || deferred.length !== expectedEntities.length) {
    throw new Error('Campaign and GrowthOperation must both remain explicitly deferred')
  }

  for (const entry of deferred) {
    const evidence = entry?.admissionEvidence
    const evidenceKeys = [
      'featureOperationContract',
      'entityFieldContract',
      'persistenceContract',
      'governanceAccessContract',
      'sourceMigration',
      'postgresqlTranslation',
    ]
    if (
      entry.status !== 'LOGICAL_OWNER_ONLY_SCHEMA_NOT_ADMITTED' ||
      typeof entry.reason !== 'string' ||
      entry.reason.length < 80 ||
      !Array.isArray(entry.requiredBeforeAdmission) ||
      entry.requiredBeforeAdmission.length < 5 ||
      !evidence ||
      evidenceKeys.some((key) => evidence[key] !== null)
    ) {
      throw new Error('Deferred W11 entity ' + entry.entity +
        ' requires a concrete reason, prerequisites and null source-admission evidence')
    }
  }

  const w09Deferred = w09SchemaContract.deferredOwners?.W11
  if (
    w09Deferred?.status !== 'SOURCE_AND_BINDING_NOT_ADMITTED' ||
    !sameSet(w09Deferred.entities ?? [], expectedEntities)
  ) {
    throw new Error('W09 D1-03 schema contract must continue to defer the exact W11 entity set')
  }
  const w09SchemaEntities = Object.values(w09SchemaContract.schema?.tables ?? {})
    .map((table) => table?.entity)
  if (expectedEntities.some((entity) => w09SchemaEntities.includes(entity))) {
    throw new Error('W11 Campaign/GrowthOperation must not be present in the admitted W09 D1-03 physical schema')
  }

  const d1_03 = bootstrap.domains?.find((domain) => domain.domainId === 'D1-03')
  if (
    !d1_03 ||
    d1_03.schemaProgress?.W11?.status !== 'SOURCE_AND_BINDING_NOT_ADMITTED' ||
    !sameSet(d1_03.schemaProgress?.W11?.entities ?? [], expectedEntities) ||
    (d1_03.schemaSources ?? []).includes(
      'workers/W11-growth-campaign-analytics-operations/migrations',
    )
  ) {
    throw new Error('Five-domain bootstrap must not admit W11 analytics migrations as D1-03 schema sources')
  }

  if (
    !readme.includes('W11 may use D1-03 only within an explicitly admitted governance contract') ||
    !readme.includes('its analytics persistence binding is D1-05')
  ) {
    throw new Error('W11 README must retain the explicit-governance-contract and D1-05-only analytics boundary')
  }

  const d1Bindings = wrangler.d1_databases ?? []
  if (
    wrangler.name !== 'luckread-w11' ||
    d1Bindings.length !== 1 ||
    d1Bindings[0]?.binding !== 'D1_05' ||
    d1Bindings[0]?.database_name !== 'allluck' ||
    d1Bindings[0]?.database_id !== '77d82be2-d12e-4a17-b410-9aa7d376bc11' ||
    d1Bindings[0]?.migrations_dir !== 'migrations'
  ) {
    throw new Error('W11 Wrangler must retain its single D1_05 analytics binding; D1-03 access is not admitted')
  }

  const envInterface = worker.match(/export interface W11Env\s*\{([\s\S]*?)\}/)?.[1] ?? ''
  if (!envInterface.includes('D1_05:') || /\bD1_03\b/.test(envInterface)) {
    throw new Error('W11 runtime environment must expose D1_05 only; no D1_03 binding may be inferred')
  }

  if (
    d1_05OwnerBoundary.domain !== 'D1-05' ||
    d1_05OwnerBoundary.primaryWorker !== 'W11' ||
    !String(d1_05OwnerBoundary.authority ?? '').startsWith('Analytics-only derived data') ||
    expectedEntities.some((entity) => (d1_05OwnerBoundary.owners?.W11 ?? []).includes(entity))
  ) {
    throw new Error('D1-05 must remain W11 analytics-derived authority, not Campaign/GrowthOperation authority')
  }

  const declaredMigrations = manifest.d1_05Separation?.analyticsMigrationFiles ?? []
  if (!sameSet(declaredMigrations, expectedAnalyticsMigrations)) {
    throw new Error('Manifest must enumerate exactly the four current W11 D1-05 analytics migrations')
  }

  const createdTables = []
  for (const migrationPath of expectedAnalyticsMigrations) {
    const sql = required(readSource, migrationPath)
    if (!/W11\s*\/\s*D1-05/i.test(sql.slice(0, 900))) {
      throw new Error('W11 migration is not explicitly scoped to D1-05: ' + migrationPath)
    }
    const tables = createdTableNames(sql)
    if (tables.length === 0 || tables.some((name) => !name.startsWith('analytics_'))) {
      throw new Error('W11 D1-05 migration created a non-analytics table: ' + migrationPath)
    }
    createdTables.push(...tables)
  }

  if (createdTables.some((name) => /campaign|growth_operation/i.test(name))) {
    throw new Error('D1-05 analytics migrations must not define T22 Campaign/GrowthOperation tables')
  }

  const safety = manifest.safety ?? {}
  if (
    safety.newTables !== 0 ||
    safety.newWorkers !== 0 ||
    safety.newD1Databases !== 0 ||
    safety.newQueues !== 0 ||
    safety.newServiceBindings !== 0 ||
    safety.runtimeBindingsChanged !== false ||
    safety.remoteNeonDdlExecuted !== false ||
    safety.cloudflareD1Touched !== false ||
    safety.businessDataImported !== false ||
    safety.productionCutoverAuthorized !== false
  ) {
    throw new Error('W11 owner reconciliation must remain inventory-only with no remote or runtime mutation')
  }

  if (fileExists('workers/W11-growth-campaign-analytics-operations/src/neon-postgres-migrations')) {
    throw new Error('W11 D1-03 PostgreSQL migration directory exists without separate source admission; review before proceeding')
  }

  return {
    domainId: 'D1-03',
    worker: 'W11',
    task: 'T22',
    logicalOwnerEntities: expectedEntities.length,
    admittedPhysicalSchemaEntities: [],
    deferredPhysicalSchemaEntities: [...expectedEntities].sort(),
    d1_05Task: 'T23',
    d1_05AnalyticsMigrationFiles: expectedAnalyticsMigrations.length,
    d1_05AnalyticsTableDefinitions: createdTables.length,
    d1_03BindingPresent: false,
    unclassifiedEntities: 0,
    inventedTables: 0,
    remoteNeonDdlExecuted: false,
    cloudflareD1Touched: false,
    productionCutoverAuthorized: false,
  }
}

function run() {
  const result = verifyW11D103OwnerReconciliation()
  process.stdout.write('NEON_D1_03_W11_OWNER_RECONCILIATION_PASS ' +
    JSON.stringify(result) + '\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
