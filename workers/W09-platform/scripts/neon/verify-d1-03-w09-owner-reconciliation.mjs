#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const repositoryRoot = path.resolve(path.dirname(scriptPath), '../../../..')

const paths = {
  manifest: 'contracts/database/neon-d1-03-w09-owner-reconciliation.v1.json',
  ownerBoundary: 'contracts/transport/d1-03-entity-owner-boundary.v1.json',
  domainMaster: 'docs/09-D1-DOMAIN-MASTER-v1.0.md',
  schemaContract: 'contracts/database/neon-d1-03-w09-platform-schema.v1.json',
  schemaArtifact: 'workers/W09-platform/src/neon-postgres-migrations/0001_w09_d1_03_platform_schema.sql',
}

function required(readSource, relativePath) {
  const value = readSource(relativePath)
  if (typeof value !== 'string') throw new Error(`Missing required W09 owner-reconciliation source: ${relativePath}`)
  return value
}

function parseJson(readSource, relativePath) {
  try {
    return JSON.parse(required(readSource, relativePath))
  } catch (error) {
    throw new Error(`Invalid JSON source ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sorted(values) {
  return [...values].sort()
}

function sameSet(actual, expected) {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected))
}

function snakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export function verifyW09D103OwnerReconciliation({
  readSource = (relativePath) => {
    try { return readFileSync(path.join(repositoryRoot, relativePath), 'utf8') } catch { return null }
  },
} = {}) {
  const manifest = parseJson(readSource, paths.manifest)
  const ownerBoundary = parseJson(readSource, paths.ownerBoundary)
  const schemaContract = parseJson(readSource, paths.schemaContract)
  const domainMaster = required(readSource, paths.domainMaster)
  const schemaArtifact = required(readSource, paths.schemaArtifact)

  if (manifest.scope?.domainId !== 'D1-03' ||
      manifest.scope?.worker !== 'W09' ||
      manifest.status !== 'LOGICAL_OWNERS_RECONCILED_SCHEMA_ADMISSION_PARTIAL') {
    throw new Error('W09 owner-reconciliation manifest must remain a partial D1-03 schema admission record')
  }

  if (ownerBoundary.domain !== 'D1-03' ||
      ownerBoundary.crossCutting?.AuditEvent?.owner !== 'W09') {
    throw new Error('D1-03 owner boundary must retain W09 AuditEvent ownership')
  }

  const logicalOwners = [
    ...(ownerBoundary.owners?.W09 ?? []),
    ...Object.entries(ownerBoundary.crossCutting ?? {})
      .filter(([, definition]) => definition?.owner === 'W09')
      .map(([entity]) => entity),
  ]
  if (new Set(logicalOwners).size !== logicalOwners.length) {
    throw new Error('D1-03 W09 logical owner map contains duplicate entity assignments')
  }
  if (!sameSet(manifest.logicalOwnerEntities ?? [], logicalOwners)) {
    throw new Error('W09 logical owner entities are not completely classified by the reconciliation manifest')
  }

  const admitted = manifest.admittedPhysicalSchemaEntities ?? []
  const physicalOwner = schemaContract.primaryOwner
  if (physicalOwner?.worker !== 'W09' || !sameSet(physicalOwner.entities ?? [], admitted)) {
    throw new Error('W09 admitted physical schema entities must exactly match the W09 schema contract')
  }

  const schemaEntities = Object.values(schemaContract.schema?.tables ?? {}).map((table) => table?.entity)
  if (!sameSet(schemaEntities, admitted)) {
    throw new Error('W09 physical schema tables contain missing, extra, or unadmitted logical entities')
  }

  const deferred = manifest.deferredPhysicalSchemaEntities ?? []
  const deferredNames = deferred.map((entry) => entry?.entity)
  if (deferred.length === 0 || deferred.some((entry) =>
    entry?.status !== 'LOGICAL_OWNER_ONLY_SCHEMA_NOT_ADMITTED' ||
    typeof entry?.reason !== 'string' ||
    entry.reason.length < 40 ||
    !Array.isArray(entry.requiredBeforeAdmission) ||
    entry.requiredBeforeAdmission.length < 4
  )) {
    throw new Error('Every deferred W09 entity requires an explicit non-admission reason and concrete admission prerequisites')
  }

  for (const entry of deferred) {
    const evidence = entry.admissionEvidence
    if (!evidence ||
        evidence.entityFieldContract !== null ||
        evidence.persistenceContract !== null ||
        evidence.sourceMigration !== null ||
        evidence.postgresqlTranslation !== null) {
      throw new Error(`Deferred W09 entity ${entry.entity} must not claim unadmitted source or translation evidence`)
    }
    if (schemaEntities.includes(entry.entity) ||
        schemaArtifact.includes(`CREATE TABLE ${snakeCase(entry.entity)} `)) {
      throw new Error(`Deferred W09 entity ${entry.entity} must not have a physical table in the admitted schema`)
    }
  }

  if (new Set(deferredNames).size !== deferredNames.length ||
      !sameSet([...admitted, ...deferredNames], logicalOwners) ||
      admitted.some((entity) => deferredNames.includes(entity))) {
    throw new Error('W09 admitted and deferred entities must partition the logical owner set exactly once')
  }

  for (const entity of logicalOwners) {
    if (!domainMaster.includes(`| ${entity} | W09 |`)) {
      throw new Error(`Canonical D1 Domain Master does not identify W09 as owner of ${entity}`)
    }
  }

  if (manifest.authoritySources?.ownerBoundary !== paths.ownerBoundary ||
      manifest.authoritySources?.domainMaster !== paths.domainMaster ||
      manifest.authoritySources?.physicalSchemaContract !== paths.schemaContract) {
    throw new Error('W09 owner-reconciliation manifest must bind the canonical ownership and physical schema sources')
  }

  const safety = manifest.safety ?? {}
  if (safety.newTables !== 0 ||
      safety.newWorkers !== 0 ||
      safety.newD1Databases !== 0 ||
      safety.newQueues !== 0 ||
      safety.newServiceBindings !== 0 ||
      safety.runtimeBindingsChanged !== false ||
      safety.remoteNeonDdlExecuted !== false ||
      safety.cloudflareD1Touched !== false ||
      safety.businessDataImported !== false ||
      safety.productionCutoverAuthorized !== false) {
    throw new Error('W09 owner reconciliation must remain inventory-only and schema-source-only')
  }

  return {
    domainId: 'D1-03',
    worker: 'W09',
    logicalOwnerEntities: logicalOwners.length,
    admittedPhysicalSchemaEntities: sorted(admitted),
    deferredPhysicalSchemaEntities: sorted(deferredNames),
    unclassifiedEntities: 0,
    inventedTables: 0,
    remoteNeonDdlExecuted: false,
    cloudflareD1Touched: false,
    productionCutoverAuthorized: false,
  }
}

function run() {
  const result = verifyW09D103OwnerReconciliation()
  process.stdout.write('NEON_D1_03_W09_OWNER_RECONCILIATION_PASS ' + JSON.stringify(result) + '\\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
