#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const requireFromW02 = createRequire(resolve(repositoryRoot, 'workers/W02-identity/package.json'))
const ledgerSqlPath = 'scripts/neon/d1-01/0001_schema_migration_ledger.sql'
const ledgerTable = 'neon_schema_migration_ledger'
const ledgerFunction = 'neon_schema_migration_ledger_reject_mutation'
const runnerVersion = 'd1-03-05-shared-schema-executor/1.0.0'
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

export const DOMAIN_MANIFESTS = Object.freeze({
  'D1-03': 'contracts/database/neon-d1-03-shared-migration-manifest.v1.json',
  'D1-04': 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json',
  'D1-05': 'contracts/database/neon-d1-05-shared-migration-manifest.v1.json',
})

const DOMAIN_CONFIG = Object.freeze({
  'D1-03': {
    databaseName: 'luckread_governance',
    cloudflareD1DatabaseUuid: 'bda1d247-a371-4244-91ae-aef96034db7f',
    localDatabaseName: 'luckread_d1_03_shared',
    ledgerOwners: ['W05', 'W06', 'W09'],
  },
  'D1-04': {
    databaseName: 'luckread_finance',
    cloudflareD1DatabaseUuid: '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736',
    localDatabaseName: 'luckread_d1_04_shared',
    ledgerOwners: ['W07'],
  },
  'D1-05': {
    databaseName: 'allluck',
    cloudflareD1DatabaseUuid: '77d82be2-d12e-4a17-b410-9aa7d376bc11',
    localDatabaseName: 'alluck_d1_05_shared',
    ledgerOwners: ['W11'],
  },
})

const fail = (message) => { throw new Error('shared schema executor: ' + message) }
const readText = (relativePath) => readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
const readJson = (relativePath) => JSON.parse(readText(relativePath))

function isSafeRepositoryPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 ||
      relativePath.startsWith('/') || relativePath.includes('\\') ||
      relativePath.split('/').includes('..')) return false
  const absolutePath = resolve(repositoryRoot, relativePath)
  return absolutePath.startsWith(repositoryRoot + sep)
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalJson(value[key]),
    ).join(',') + '}'
  }
  return JSON.stringify(value)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function stripOuterTransaction(sql, migrationId = 'unknown') {
  const lines = String(sql).split(/\r?\n/)
  const significant = []
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed && !trimmed.startsWith('--')) significant.push(i)
  }
  if (significant.length === 0) fail('SQL artifact is empty: ' + migrationId)
  const first = significant[0]
  const last = significant[significant.length - 1]
  const begins = /^BEGIN\s*;$/i.test(lines[first].trim())
  const commits = /^COMMIT\s*;$/i.test(lines[last].trim())
  if (begins !== commits) fail('migration has an incomplete outer transaction wrapper: ' + migrationId)
  if (begins && commits) {
    lines[first] = ''
    lines[last] = ''
  }
  return lines.join('\n').trim()
}

export function validateManifestShape(manifest) {
  const errors = []
  const config = DOMAIN_CONFIG[manifest?.domainId]
  if (!config) return { valid: false, errors: ['domainId must be exactly D1-03, D1-04 or D1-05'] }

  if (manifest.databaseName !== config.databaseName ||
      manifest.cloudflareD1DatabaseUuid !== config.cloudflareD1DatabaseUuid ||
      manifest.postgresMajor !== 18 ||
      manifest.ledger?.table !== ledgerTable ||
      manifest.ledger?.ddlPath !== ledgerSqlPath ||
      manifest.ledger?.domainId !== manifest.domainId ||
      manifest.ledger?.databaseName !== config.databaseName) {
    errors.push('manifest must pin the exact existing D1 domain, database, PostgreSQL 18 target and shared ledger')
  }
  if (manifest.localRehearsal?.allowed !== true ||
      manifest.localRehearsal?.databaseName !== config.localDatabaseName ||
      manifest.localRehearsal?.postgresMajor !== 18 ||
      manifest.localRehearsal?.environmentVariable !== 'D1_SHARED_LOCAL_DATABASE_URL') {
    errors.push('manifest must use the exact disposable local PostgreSQL 18 target')
  }
  if (manifest.remoteApplyReady !== false ||
      manifest.businessDataImport !== false ||
      manifest.productionCutoverAuthorized !== false) {
    errors.push('this runner accepts schema-only local rehearsals; remote apply, data import and cutover must remain disabled')
  }
  if (!Array.isArray(manifest.remoteApplyBlockers) || manifest.remoteApplyBlockers.length === 0) {
    errors.push('each domain must retain an explicit remote-apply blocker until its separate release review')
  }
  const safety = manifest.safety ?? {}
  for (const key of ['runtimeBindingsChanged', 'remoteNeonDdlExecuted', 'cloudflareD1Touched',
    'businessDataImported', 'productionCutoverAuthorized']) {
    if (safety[key] !== false) errors.push('safety.' + key + ' must remain false')
  }
  for (const key of ['newWorkers', 'newD1Databases', 'newQueues', 'newServiceBindings']) {
    if (safety[key] !== 0) errors.push('safety.' + key + ' must remain zero')
  }

  const entries = manifest.entries
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push('manifest must contain at least one ordered PostgreSQL SQL migration')
    return { valid: false, errors }
  }
  const ids = new Set()
  const orders = new Set()
  let previousOrder = 0
  const allowedOwners = new Set(config.ledgerOwners)

  for (const entry of entries) {
    if (!entry || typeof entry.migrationId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(entry.migrationId) ||
        ids.has(entry.migrationId)) {
      errors.push('migration ids must be unique and match the shared ledger format')
    }
    if (!Number.isSafeInteger(entry.order) || entry.order <= previousOrder || orders.has(entry.order)) {
      errors.push('migration orders must be unique, positive and strictly increasing')
    }
    if (!allowedOwners.has(entry.ownerWorker)) {
      errors.push('ledger owner is not allowed for ' + manifest.domainId + ': ' + String(entry.ownerWorker))
    }
    if (!['POSTGRESQL_SQL', 'GENERATED_POSTGRESQL_SQL'].includes(entry.kind)) {
      errors.push('unsupported migration kind for ' + String(entry.migrationId))
    }
    if (!Array.isArray(entry.artifactPaths) || entry.artifactPaths.length !== 1 ||
        !isSafeRepositoryPath(entry.artifactPaths[0]) || !entry.artifactPaths[0].endsWith('.sql')) {
      errors.push('each migration must have exactly one safe committed PostgreSQL .sql artifact: ' + String(entry.migrationId))
    }
    if (!Array.isArray(entry.sourceMigrations) || entry.sourceMigrations.length === 0 ||
        entry.sourceMigrations.some((item) => !isSafeRepositoryPath(item))) {
      errors.push('each migration must name its admitted source migration paths: ' + String(entry.migrationId))
    }
    if (!isSafeRepositoryPath(entry.schemaContract)) {
      errors.push('each migration must name a safe source schema contract: ' + String(entry.migrationId))
    }
    if (!Array.isArray(entry.dependsOn)) errors.push('dependsOn must be an array: ' + String(entry.migrationId))
    else for (const dependency of entry.dependsOn) {
      if (!ids.has(dependency)) errors.push('dependency must appear before its dependent migration: ' + String(dependency))
    }

    if (entry.logicalOwnerWorker && entry.logicalOwnerWorker !== entry.ownerWorker) {
      const exactW10ConfigMapping = manifest.domainId === 'D1-03' &&
        entry.logicalOwnerWorker === 'W10' &&
        entry.ownerWorker === 'W09' &&
        entry.migrationConfigOwner === 'W09'
      if (!exactW10ConfigMapping) {
        errors.push('logical owner may differ from ledger owner only for W10 under the W09 D1-03 migration config')
      }
    }
    if (entry.migrationConfigOwner && entry.migrationConfigOwner !== entry.ownerWorker) {
      errors.push('migrationConfigOwner must match the shared ledger ownerWorker: ' + String(entry.migrationId))
    }

    ids.add(entry.migrationId)
    orders.add(entry.order)
    previousOrder = Number.isSafeInteger(entry.order) ? entry.order : previousOrder
  }

  const expected = manifest.expected ?? {}
  for (const key of ['tables', 'explicitIndexes', 'triggers', 'triggerFunctions', 'foreignKeys', 'businessRows', 'controlSeedRows']) {
    if (!Number.isSafeInteger(expected[key]) || expected[key] < 0) {
      errors.push('manifest.expected.' + key + ' must be a non-negative integer')
    }
  }
  if (expected.businessRows !== 0) errors.push('schema-only local rehearsal requires zero business rows')
  const seedRows = manifest.seedRows ?? []
  if (!Array.isArray(seedRows)) {
    errors.push('manifest.seedRows must be an explicit array; no implicit seed rows are allowed')
  } else {
    const seedTables = new Set()
    let controlSeedRowCount = 0
    for (const seed of seedRows) {
      if (!seed || typeof seed.table !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(seed.table) ||
          seedTables.has(seed.table)) {
        errors.push('control seed table names must be unique safe SQL identifiers')
      }
      if (seed?.kind !== 'SCHEMA_CONTROL_METADATA_NOT_BUSINESS_DATA' ||
          !allowedOwners.has(seed?.ownerWorker) ||
          !isSafeRepositoryPath(seed?.sourceContract) ||
          !Array.isArray(seed?.rows) || seed.rows.length !== 1) {
        errors.push('each control seed must name one exact admitted schema-control row and its owner contract')
      }
      for (const row of seed?.rows ?? []) {
        if (!row || typeof row !== 'object' || Array.isArray(row) ||
            Object.keys(row).length === 0 ||
            Object.entries(row).some(([column, value]) =>
              !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(column) ||
              !(value === null || typeof value === 'string' ||
                typeof value === 'boolean' ||
                (typeof value === 'number' && Number.isFinite(value))))) {
          errors.push('control seed rows must contain only safe column identifiers and JSON scalar values')
        }
        controlSeedRowCount++
      }
      if (typeof seed?.table === 'string') seedTables.add(seed.table)
    }
    if (expected.controlSeedRows !== controlSeedRowCount) {
      errors.push('manifest.expected.controlSeedRows must exactly match the explicit schema-control seed rows')
    }
  }
  const sourceMigrationCount = entries.reduce((sum, entry) =>
    sum + (Array.isArray(entry.sourceMigrations) ? entry.sourceMigrations.length : 0), 0)
  if (manifest.sourceMigrationCount !== undefined &&
      manifest.sourceMigrationCount !== sourceMigrationCount) {
    errors.push('sourceMigrationCount does not match the listed D1 source migrations')
  }
  return { valid: errors.length === 0, errors, config, entries, sourceMigrationCount }
}

function contractArtifactPaths(contract) {
  return [
    contract.primaryOwner?.migrationArtifact,
    contract.primaryOwner?.postgresArtifact,
    contract.artifacts?.migration,
    contract.verification?.postgresMigration,
  ].filter((value) => typeof value === 'string')
}

function validateEntryContract(manifest, entry, readSource = readText) {
  if (!isSafeRepositoryPath(entry.schemaContract)) fail('unsafe schema contract path: ' + entry.schemaContract)
  const contract = JSON.parse(readSource(entry.schemaContract))
  if (contract.target?.domainId !== manifest.domainId ||
      contract.target?.databaseName !== manifest.databaseName ||
      contract.target?.postgresMajor !== 18) {
    fail('schema contract target does not match migration manifest: ' + entry.schemaContract)
  }
  const contractLogicalOwner = contract.primaryOwner?.worker ?? contract.target?.primaryWorker
  if (contractLogicalOwner !== entry.logicalOwnerWorker &&
      contractLogicalOwner !== entry.ownerWorker) {
    fail('schema contract logical owner does not match the manifest: ' + entry.schemaContract)
  }
  if (entry.migrationConfigOwner &&
      contract.primaryOwner?.migrationConfigOwner !== entry.migrationConfigOwner) {
    fail('schema contract migration-config owner does not match the manifest: ' + entry.schemaContract)
  }
  if (!String(contract.status ?? '').includes('REHEARSAL_PASSED')) {
    fail('source schema contract does not record a completed local rehearsal: ' + entry.schemaContract)
  }
  const artifactPath = entry.artifactPaths[0]
  if (!contractArtifactPaths(contract).includes(artifactPath)) {
    fail('PostgreSQL artifact path is not admitted by the source schema contract: ' + artifactPath)
  }
  return contract
}

function extractSqlEffects(sql) {
  const uncommented = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^--.*$/gm, '')
  const tables = [...uncommented.matchAll(/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:public\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)]
    .map((match) => match[1])
  const indexes = [...uncommented.matchAll(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)]
    .map((match) => match[1])
  const functions = [...uncommented.matchAll(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)]
    .map((match) => match[1])
  const triggerOperations = [...uncommented.matchAll(/\b(DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?|CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+)([A-Za-z_][A-Za-z0-9_$]*)/gim)]
    .map((match) => ({index:match.index,operation:/^DROP/i.test(match[1])?'DROP':'CREATE',name:match[2]}))
  const referenceCode = uncommented
    .replace(/(\$[A-Za-z_0-9]*\$)[\s\S]*?\1/g, ' ')
    .replace(/'(?:''|[^'])*'/g, ' ')
  const references = [...referenceCode.matchAll(/\bREFERENCES\s+(?:(?:public)\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?/gim)]
    .map((match) => match[1])
  return {tables,indexes,functions,triggerOperations,references,uncommented}
}

function bundleChecksum(relativePath, content) {
  const bundle = createHash('sha256')
  const pathBytes = Buffer.from(relativePath, 'utf8')
  const pathLength = Buffer.alloc(4)
  pathLength.writeUInt32BE(pathBytes.length)
  const contentLength = Buffer.alloc(8)
  contentLength.writeBigUInt64BE(BigInt(content.length))
  bundle.update(pathLength).update(pathBytes).update(contentLength).update(content)
  return bundle.digest('hex')
}

export function buildDomainPlan(manifest, {
  readBytes = (relativePath) => readFileSync(resolve(repositoryRoot, relativePath)),
  readSource = readText,
} = {}) {
  const shape = validateManifestShape(manifest)
  if (!shape.valid) fail(shape.errors.join('; '))

  const entries = []
  const allTables = new Set()
  const allIndexes = new Set()
  const functionNames = new Set()
  const triggerNames = new Set()
  const allReferences = []
  const sourceOwnerByTable = new Map()
  const ledgerChecksums = []

  for (const entry of shape.entries) {
    validateEntryContract(manifest, entry, readSource)
    const relativePath = entry.artifactPaths[0]
    const bytesValue = readBytes(relativePath)
    const bytes = Buffer.isBuffer(bytesValue) ? bytesValue : Buffer.from(bytesValue)
    if (bytes.length === 0) fail('SQL artifact is empty: ' + relativePath)
    const sql = bytes.toString('utf8')
    const body = stripOuterTransaction(sql, entry.migrationId)
    const uncommented = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^--.*$/gm, '')
    if (entry.kind === 'GENERATED_POSTGRESQL_SQL' && !/^-- GENERATED FILE\./m.test(sql)) {
      fail('generated PostgreSQL artifact is missing its generated-file marker: ' + relativePath)
    }
    if (/\b(?:PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB|json_valid|json_extract|json_object|randomblob)\b|\bINSERT\s+OR\s+IGNORE\b/i.test(uncommented)) {
      fail('SQLite-only syntax is forbidden in shared PostgreSQL artifacts: ' + relativePath)
    }
    if (/\b(?:CREATE|DROP)\s+(?:DATABASE|ROLE|USER|SCHEMA)\b|\bDROP\s+SCHEMA\s+public\b/i.test(uncommented)) {
      fail('database, role and schema-level DDL is forbidden in domain schema artifacts: ' + relativePath)
    }

    const effects = extractSqlEffects(body)
    if (effects.tables.length === 0) fail('SQL artifact declares no table effect: ' + relativePath)
    for (const name of effects.tables) {
      if (allTables.has(name)) fail('duplicate table declaration across the domain manifest: ' + name)
      allTables.add(name)
      sourceOwnerByTable.set(name, entry.logicalOwnerWorker || entry.ownerWorker)
    }
    for (const name of effects.indexes) {
      if (allIndexes.has(name)) fail('duplicate explicit index declaration across the domain manifest: ' + name)
      allIndexes.add(name)
    }
    for (const name of effects.functions) {
      if (functionNames.has(name)) fail('duplicate domain trigger function declaration: ' + name)
      functionNames.add(name)
    }
    for (const operation of effects.triggerOperations) {
      if (operation.operation === 'DROP') {
        triggerNames.delete(operation.name)
      } else {
        if (triggerNames.has(operation.name)) fail('trigger is recreated without a prior DROP in the ordered manifest: ' + operation.name)
        triggerNames.add(operation.name)
      }
    }
    allReferences.push(...effects.references)
    const artifactSha256 = bundleChecksum(relativePath, bytes)
    const manifestEntrySha256 = sha256(Buffer.from(canonicalJson(entry), 'utf8'))
    ledgerChecksums.push({
      migrationId:entry.migrationId,
      ownerWorker:entry.ownerWorker,
      order:entry.order,
      kind:entry.kind,
      artifactSha256,
      manifestEntrySha256,
      artifactPaths:[...entry.artifactPaths],
    })
    entries.push({entry,relativePath,sql,body,effects,artifactSha256,manifestEntrySha256})
  }

  for (const reference of allReferences) {
    if (!allTables.has(reference)) {
      fail('cross-domain or unadmitted foreign-key reference is forbidden: ' + reference)
    }
  }
  const seedRowsByTable = new Map()
  let controlSeedRows = 0
  for (const seed of manifest.seedRows ?? []) {
    if (!allTables.has(seed.table)) fail('control seed names a table outside the domain manifest: ' + seed.table)
    if (seed.ownerWorker !== sourceOwnerByTable.get(seed.table)) {
      fail('control seed owner does not match the schema artifact owner: ' + seed.table)
    }
    const seedContract = JSON.parse(readSource(seed.sourceContract))
    if (seedContract.target?.domainId !== manifest.domainId ||
        seedContract.target?.databaseName !== manifest.databaseName ||
        seedContract.target?.postgresMajor !== 18 ||
        seedContract.primaryOwner?.worker !== seed.ownerWorker) {
      fail('control seed source contract target or owner does not match the domain manifest: ' + seed.sourceContract)
    }
    const tableContract = seedContract.schema?.tables?.[seed.table]
    if (tableContract?.seedRowKind !== seed.kind ||
        canonicalJson(tableContract?.seededControlRow) !== canonicalJson(seed.rows[0])) {
      fail('control seed does not exactly match the admitted schema-control row: ' + seed.table)
    }
    seedRowsByTable.set(seed.table, seed.rows)
    controlSeedRows += seed.rows.length
  }
  if (controlSeedRows !== manifest.expected.controlSeedRows) {
    fail('control seed row total does not match the reviewed domain manifest')
  }

  const expected = manifest.expected
  if (allTables.size !== expected.tables ||
      allIndexes.size !== expected.explicitIndexes ||
      triggerNames.size !== expected.triggers ||
      functionNames.size !== expected.triggerFunctions ||
      allReferences.length !== expected.foreignKeys) {
    fail('manifest catalog totals do not match SQL bundle: tables=' + allTables.size +
      ', indexes=' + allIndexes.size + ', triggers=' + triggerNames.size +
      ', functions=' + functionNames.size + ', foreignKeys=' + allReferences.length)
  }
  return {
    manifest,
    entries,
    ledgerChecksums,
    tables:[...allTables].sort(),
    indexes:[...allIndexes].sort(),
    triggers:[...triggerNames].sort(),
    functions:[...functionNames].sort(),
    references:[...allReferences].sort(),
    sourceOwnerByTable,
    seedRowsByTable,
    controlSeedRows,
  }
}

export function validateLocalTarget(connectionString, manifest) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return {valid:false,reason:'D1_SHARED_LOCAL_DATABASE_URL is required'}
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return {valid:false,reason:'local PostgreSQL URL is invalid'}
  }
  const config = DOMAIN_CONFIG[manifest?.domainId]
  const database = (() => {
    try { return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) } catch { return '' }
  })()
  if (!config || !['postgres:','postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1','localhost','postgres'].includes(parsed.hostname) ||
      parsed.port !== '5432' || database !== config.localDatabaseName) {
    return {valid:false,reason:'executor accepts only the exact disposable local PostgreSQL 18 database for this domain'}
  }
  if (!parsed.username || !parsed.password || parsed.search || parsed.hash) {
    return {valid:false,reason:'local PostgreSQL credentials are required and URL query/fragment parameters are forbidden'}
  }
  return {valid:true,parsed}
}

export function assertLedgerPrefixRows(manifest, plan, rows) {
  const entries = plan.entries.map((item) => item.entry)
  const checksums = new Map(plan.ledgerChecksums.map((item) => [item.migrationId,item]))
  if (!Array.isArray(rows) || rows.length > entries.length) {
    fail('existing shared ledger must contain only an ordered prefix of this domain manifest')
  }
  for (let i = 0; i < rows.length; i++) {
    const expected = entries[i]
    const checksum = checksums.get(expected.migrationId)
    const row = rows[i]
    if (row.domain_id !== manifest.domainId ||
        row.database_name !== manifest.databaseName ||
        row.owner_worker !== expected.ownerWorker ||
        row.migration_id !== expected.migrationId ||
        Number(row.migration_order) !== expected.order ||
        row.migration_kind !== expected.kind ||
        row.artifact_sha256 !== checksum.artifactSha256 ||
        row.manifest_entry_sha256 !== checksum.manifestEntrySha256 ||
        !SHA.test(row.source_commit_sha || '') ||
        typeof row.runner_version !== 'string' || row.runner_version.length === 0 ||
        typeof row.execution_id !== 'string' || row.execution_id.length === 0) {
      fail('existing shared ledger row does not exactly match the immutable manifest prefix at position ' + i)
    }
  }
  return entries.slice(0, rows.length)
}

async function actualPublicTables(client) {
  const result = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'pg_%' ORDER BY tablename",
  )
  return result.rows.map((row) => row.tablename)
}

async function verifyPublicSchema(client) {
  const schemas = await client.query(
    "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' ORDER BY nspname",
  )
  if (JSON.stringify(schemas.rows.map((row) => row.nspname)) !== JSON.stringify(['public'])) {
    fail('unexpected non-system schema exists: ' + schemas.rows.map((row) => row.nspname).join(','))
  }
  const extensions = await client.query('SELECT extname FROM pg_catalog.pg_extension ORDER BY extname')
  if (JSON.stringify(extensions.rows.map((row) => row.extname)) !== JSON.stringify(['plpgsql'])) {
    fail('PostgreSQL extension set must remain exactly plpgsql')
  }
}

async function verifyLedgerSchema(client) {
  const columns = await client.query(
    "SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY column_name",
    [ledgerTable],
  )
  const expectedColumns = [
    'applied_at','artifact_sha256','database_name','domain_id','execution_id',
    'manifest_entry_sha256','migration_id','migration_kind','migration_order',
    'owner_worker','runner_version','source_commit_sha',
  ]
  if (JSON.stringify(columns.rows.map((row) => row.column_name)) !== JSON.stringify(expectedColumns)) {
    fail('shared append-only migration ledger column set does not match its contract')
  }
  if (columns.rows.some((row) => row.is_nullable !== 'NO')) {
    fail('shared migration ledger columns must all be NOT NULL')
  }
  const columnByName = new Map(columns.rows.map((row) => [row.column_name,row]))
  if (columnByName.get('migration_order')?.data_type !== 'integer' ||
      columnByName.get('applied_at')?.data_type !== 'timestamp with time zone') {
    fail('shared migration ledger column types do not match its contract')
  }
  const indexes = await client.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename=$1 ORDER BY indexname",
    [ledgerTable],
  )
  const expectedIndexes = [
    'neon_schema_migration_ledger_order_unique',
    'neon_schema_migration_ledger_owner_applied_idx',
    'neon_schema_migration_ledger_pkey',
  ]
  if (JSON.stringify(indexes.rows.map((row) => row.indexname)) !== JSON.stringify(expectedIndexes)) {
    fail('shared migration ledger index set does not match its contract')
  }
  const triggers = await client.query(
    "SELECT t.tgname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=$1 AND NOT t.tgisinternal ORDER BY t.tgname",
    [ledgerTable],
  )
  const expectedTriggers = [
    'neon_schema_migration_ledger_no_truncate',
    'neon_schema_migration_ledger_no_update_or_delete',
  ]
  if (JSON.stringify(triggers.rows.map((row) => row.tgname)) !== JSON.stringify(expectedTriggers)) {
    fail('shared ledger append-only trigger set does not match its contract')
  }
  const foreignKeys = await client.query(
    "SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND contype='f'",
    ['public.' + ledgerTable],
  )
  if (Number(foreignKeys.rows[0].count) !== 0) fail('shared migration ledger must not have foreign keys')
}

async function ensureLedger(client) {
  const present = (await client.query(
    "SELECT to_regclass('public.neon_schema_migration_ledger') IS NOT NULL AS present",
  )).rows[0].present
  if (!present) {
    const existingObjects = await client.query(
      "SELECT count(*)::integer AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%'",
    )
    if (Number(existingObjects.rows[0].count) !== 0) {
      fail('first local apply requires an empty public schema; existing public relations were found')
    }
    const ledgerSql = stripOuterTransaction(readText(ledgerSqlPath),'shared-ledger')
    await client.query('BEGIN')
    try {
      await client.query(ledgerSql)
      await client.query('COMMIT')
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    }
  }
  await verifyLedgerSchema(client)
}

async function readLedgerRows(client) {
  const result = await client.query(
    'SELECT domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,' +
    'artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id ' +
    'FROM public.neon_schema_migration_ledger ORDER BY migration_order',
  )
  return result.rows
}

async function insertLedgerRow(client, manifest, item, sourceCommitSha, executionId) {
  await client.query(
    'INSERT INTO public.neon_schema_migration_ledger ' +
    '(domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [manifest.domainId,manifest.databaseName,item.entry.ownerWorker,item.entry.migrationId,
      item.entry.order,item.entry.kind,item.artifactSha256,item.manifestEntrySha256,
      sourceCommitSha,runnerVersion,executionId],
  )
}

async function verifyOwnerSchemaState(client, manifest, plan, appliedCount) {
  const applied = plan.entries.slice(0,appliedCount)
  const expectedTables = applied.flatMap((item) => item.effects.tables).sort()
  const actualTables = (await actualPublicTables(client)).filter((name) => name !== ledgerTable)
  const missing = expectedTables.filter((name) => !actualTables.includes(name))
  const unexpected = actualTables.filter((name) => !expectedTables.includes(name))
  if (missing.length || unexpected.length) {
    fail('public table set differs from the applied migration prefix; missing=[' +
      missing.join(',') + '] unexpected=[' + unexpected.join(',') + ']')
  }
  await verifyPublicSchema(client)

  const rowCounts = {}
  let controlSeedRows = 0
  for (const table of expectedTables) {
    const result = await client.query('SELECT COUNT(*)::bigint AS count FROM public."' +
      table.replace(/"/g,'""') + '"')
    const count = Number(result.rows[0].count)
    const expectedSeedRows = plan.seedRowsByTable.get(table) ?? []
    rowCounts[table] = count
    if (count !== expectedSeedRows.length) {
      if (expectedSeedRows.length === 0) {
        fail('business table must remain empty: ' + table)
      }
      fail('schema-control seed row count differs from its exact manifest: ' + table)
    }
    for (const seedRow of expectedSeedRows) {
      const columns = Object.keys(seedRow)
      if (columns.length === 0 || columns.some((column) =>
        !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(column))) {
        fail('schema-control seed contains an unsafe column identifier: ' + table)
      }
      const predicate = columns.map((column, index) =>
        '"' + column + '" IS NOT DISTINCT FROM $' + (index + 1),
      ).join(' AND ')
      const matched = await client.query(
        'SELECT COUNT(*)::bigint AS count FROM public."' +
          table.replace(/"/g,'""') + '" WHERE ' + predicate,
        columns.map((column) => seedRow[column]),
      )
      if (Number(matched.rows[0].count) !== 1) {
        fail('schema-control seed row does not match the exact admitted values: ' + table)
      }
      controlSeedRows++
    }
  }
  if (controlSeedRows !== manifest.expected.controlSeedRows) {
    fail('actual schema-control seed row count does not match the reviewed manifest')
  }
  return {
    tableCount:expectedTables.length,
    tableRowCounts:rowCounts,
    controlSeedRows,
    businessRows:0,
  }
}
async function verifyFinalCatalog(client, manifest, plan) {
  const expectedTables = plan.tables
  const actualTables = (await actualPublicTables(client)).filter((name) => name !== ledgerTable)
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    fail('final public table set does not match the shared domain manifest')
  }
  const indexRows = await client.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY indexname",
  )
  const actualIndexNames = new Set(indexRows.rows.map((row) => row.indexname))
  const missingIndexes = plan.indexes.filter((name) => !actualIndexNames.has(name))
  if (missingIndexes.length) fail('expected explicit indexes are missing: ' + missingIndexes.join(','))
  if (plan.indexes.length !== manifest.expected.explicitIndexes) {
    fail('explicit index count differs from the reviewed manifest')
  }

  const triggerRows = await client.query(
    "SELECT t.tgname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname <> $1 AND NOT t.tgisinternal ORDER BY t.tgname",
    [ledgerTable],
  )
  const actualTriggers = triggerRows.rows.map((row) => row.tgname)
  if (JSON.stringify(actualTriggers) !== JSON.stringify(plan.triggers)) {
    fail('actual trigger set does not match the ordered migration effects')
  }

  const functionRows = await client.query(
    "SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname <> $1 ORDER BY p.proname",
    [ledgerFunction],
  )
  const actualFunctions = functionRows.rows.map((row) => row.proname)
  if (JSON.stringify(actualFunctions) !== JSON.stringify(plan.functions)) {
    fail('actual trigger/function set does not match the ordered migration effects')
  }

  const foreignKeys = await client.query(
    "SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND c.conrelid <> $1::regclass",
    ['public.' + ledgerTable],
  )
  if (Number(foreignKeys.rows[0].count) !== manifest.expected.foreignKeys) {
    fail('actual same-domain foreign-key count does not match the shared domain manifest')
  }
  const indexCount = plan.indexes.length
  if (indexCount !== manifest.expected.explicitIndexes ||
      plan.triggers.length !== manifest.expected.triggers ||
      plan.functions.length !== manifest.expected.triggerFunctions) {
    fail('final PostgreSQL object counts do not match the reviewed manifest')
  }
  return {
    tables:expectedTables.length,
    explicitIndexes:indexCount,
    triggers:plan.triggers.length,
    triggerFunctions:plan.functions.length,
    foreignKeys:Number(foreignKeys.rows[0].count),
    controlSeedRows:manifest.expected.controlSeedRows,
    businessRows:0,
  }
}

export function parseCommandLine(argv) {
  if (argv.includes('--remote-neon')) {
    return {valid:false,reason:'remote Neon execution is deliberately unavailable until the domain-specific independent review and release gate are merged'}
  }
  if (argv.length !== 3 || argv[0] !== '--domain' ||
      !Object.hasOwn(DOMAIN_MANIFESTS,argv[1]) || argv[2] !== '--local-only') {
    return {valid:false,reason:'select exactly: --domain D1-03|D1-04|D1-05 --local-only'}
  }
  return {valid:true,domainId:argv[1]}
}

async function runDomain(domainId) {
  const manifest = readJson(DOMAIN_MANIFESTS[domainId])
  const plan = buildDomainPlan(manifest)
  const target = validateLocalTarget(process.env.D1_SHARED_LOCAL_DATABASE_URL,manifest)
  if (!target.valid) fail(target.reason)

  const sourceCommitSha = process.env.GITHUB_SHA || process.env.REHEARSAL_SOURCE_COMMIT_SHA
  if (!SHA.test(sourceCommitSha || '')) fail('an exact source commit SHA is required for migration provenance')
  const executionId = 'local-' + (process.env.GITHUB_RUN_ID || 'manual') + '-' +
    (process.env.GITHUB_RUN_ATTEMPT || '1') + '-' + process.pid

  const { Pool } = requireFromW02('pg')
  const pool = new Pool({
    connectionString:process.env.D1_SHARED_LOCAL_DATABASE_URL,
    max:2,
    connectionTimeoutMillis:15000,
    idleTimeoutMillis:1000,
  })
  let lockClient
  let client
  let lockOpen = false
  try {
    lockClient = await pool.connect()
    await lockClient.query('BEGIN')
    lockOpen = true
    const identity = await lockClient.query(
      "SELECT current_database() AS database_name,current_setting('server_version_num')::integer AS version_num",
    )
    const major = Math.floor(Number(identity.rows[0]?.version_num) / 10000)
    if (identity.rows[0]?.database_name !== manifest.localRehearsal.databaseName || major !== 18) {
      fail('connected database must be the exact disposable PostgreSQL 18 target')
    }
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('luckread:neon-schema-migration:' || current_database(),0))",
    )

    client = await pool.connect()
    await ensureLedger(client)
    let ledgerRows = await readLedgerRows(client)
    let appliedEntries = assertLedgerPrefixRows(manifest,plan,ledgerRows)
    await verifyOwnerSchemaState(client,manifest,plan,appliedEntries.length)

    for (const item of plan.entries.slice(appliedEntries.length)) {
      for (const dependency of item.entry.dependsOn ?? []) {
        if (!appliedEntries.some((entry) => entry.migrationId === dependency)) {
          fail('migration dependency has not been committed: ' + dependency)
        }
      }
      await client.query('BEGIN')
      try {
        await client.query(item.body)
        await insertLedgerRow(client,manifest,item,sourceCommitSha,executionId)
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch {}
        throw error
      }
      appliedEntries = [...appliedEntries,item.entry]
      ledgerRows = await readLedgerRows(client)
      assertLedgerPrefixRows(manifest,plan,ledgerRows)
      await verifyOwnerSchemaState(client,manifest,plan,appliedEntries.length)
    }

    const finalRows = await readLedgerRows(client)
    assertLedgerPrefixRows(manifest,plan,finalRows)
    if (finalRows.length !== plan.entries.length) fail('shared schema executor did not commit every migration')
    const catalog = await verifyFinalCatalog(client,manifest,plan)
    const report = {
      reportType:'NEON_SHARED_DOMAIN_SCHEMA_LOCAL_POSTFLIGHT',
      status:'LOCAL_SCHEMA_ONLY_APPLY_PASS',
      domainId:manifest.domainId,
      databaseName:manifest.databaseName,
      localDatabaseName:manifest.localRehearsal.databaseName,
      postgresMajor:18,
      sourceCommitSha,
      runnerVersion,
      appliedMigrations:finalRows.map((row) => ({
        ownerWorker:row.owner_worker,
        migrationId:row.migration_id,
        migrationOrder:Number(row.migration_order),
        migrationKind:row.migration_kind,
        artifactSha256:row.artifact_sha256,
        manifestEntrySha256:row.manifest_entry_sha256,
        sourceCommitSha:row.source_commit_sha,
      })),
      catalog,
      safety:{
        remoteNeonTouched:false,
        cloudflareD1Touched:false,
        businessDataImported:false,
        runtimeBindingsChanged:false,
        productionCutoverAuthorized:false,
      },
      remoteApplyReady:false,
      remoteApplyBlockers:manifest.remoteApplyBlockers,
    }
    const output = process.env.D1_SHARED_SCHEMA_APPLY_REPORT ||
      'artifacts/neon/' + manifest.domainId.toLowerCase() + '-shared-runner-postflight.json'
    if (!isSafeRepositoryPath(output)) fail('postflight report path must remain inside the repository')
    mkdirSync(dirname(resolve(repositoryRoot,output)),{recursive:true})
    writeFileSync(resolve(repositoryRoot,output),JSON.stringify(report,null,2)+'\n')
    process.stdout.write('NEON_SHARED_DOMAIN_SCHEMA_LOCAL_PASS ' + JSON.stringify({
      domainId:manifest.domainId,
      databaseName:manifest.databaseName,
      postgresMajor:18,
      migrations:finalRows.length,
      tables:catalog.tables,
      explicitIndexes:catalog.explicitIndexes,
      triggers:catalog.triggers,
      triggerFunctions:catalog.triggerFunctions,
      foreignKeys:catalog.foreignKeys,
      businessRows:catalog.businessRows,
      remoteNeonTouched:false,
      cloudflareD1Touched:false,
      remoteApplyReady:false,
    })+'\n')
  } finally {
    if (client) client.release()
    if (lockClient) {
      if (lockOpen) {
        try { await lockClient.query('ROLLBACK') } catch {}
      }
      lockClient.release()
    }
    await pool.end()
  }
}

async function run() {
  const selection = parseCommandLine(process.argv.slice(2))
  if (!selection.valid) fail(selection.reason)
  await runDomain(selection.domainId)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
 + (index + 1),
      ).join(' AND ')
      const matched = await client.query(
        'SELECT COUNT(*)::bigint AS count FROM public."' +
          table.replace(/"/g,'""') + '" WHERE ' + predicate,
        columns.map((column) => seedRow[column]),
      )
      if (Number(matched.rows[0].count) !== 1) {
        fail('schema-control seed row does not match the exact admitted values: ' + table)
      }
      controlSeedRows++
    }
  }
  if (controlSeedRows !== manifest.expected.controlSeedRows) {
    fail('actual schema-control seed row count does not match the reviewed manifest')
  }
  return {
    tableCount:expectedTables.length,
    tableRowCounts:rowCounts,
    controlSeedRows,
    businessRows:0,
  }
}

async function verifyFinalCatalog(client, manifest, plan) {
  const expectedTables = plan.tables
  const actualTables = (await actualPublicTables(client)).filter((name) => name !== ledgerTable)
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
    fail('final public table set does not match the shared domain manifest')
  }
  const indexRows = await client.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' ORDER BY indexname",
  )
  const actualIndexNames = new Set(indexRows.rows.map((row) => row.indexname))
  const missingIndexes = plan.indexes.filter((name) => !actualIndexNames.has(name))
  if (missingIndexes.length) fail('expected explicit indexes are missing: ' + missingIndexes.join(','))
  if (plan.indexes.length !== manifest.expected.explicitIndexes) {
    fail('explicit index count differs from the reviewed manifest')
  }

  const triggerRows = await client.query(
    "SELECT t.tgname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname <> $1 AND NOT t.tgisinternal ORDER BY t.tgname",
    [ledgerTable],
  )
  const actualTriggers = triggerRows.rows.map((row) => row.tgname)
  if (JSON.stringify(actualTriggers) !== JSON.stringify(plan.triggers)) {
    fail('actual trigger set does not match the ordered migration effects')
  }

  const functionRows = await client.query(
    "SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname <> $1 ORDER BY p.proname",
    [ledgerFunction],
  )
  const actualFunctions = functionRows.rows.map((row) => row.proname)
  if (JSON.stringify(actualFunctions) !== JSON.stringify(plan.functions)) {
    fail('actual trigger/function set does not match the ordered migration effects')
  }

  const foreignKeys = await client.query(
    "SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND c.conrelid <> $1::regclass",
    ['public.' + ledgerTable],
  )
  if (Number(foreignKeys.rows[0].count) !== manifest.expected.foreignKeys) {
    fail('actual same-domain foreign-key count does not match the shared domain manifest')
  }
  const indexCount = plan.indexes.length
  if (indexCount !== manifest.expected.explicitIndexes ||
      plan.triggers.length !== manifest.expected.triggers ||
      plan.functions.length !== manifest.expected.triggerFunctions) {
    fail('final PostgreSQL object counts do not match the reviewed manifest')
  }
  return {
    tables:expectedTables.length,
    explicitIndexes:indexCount,
    triggers:plan.triggers.length,
    triggerFunctions:plan.functions.length,
    foreignKeys:Number(foreignKeys.rows[0].count),
    businessRows:0,
  }
}

export function parseCommandLine(argv) {
  if (argv.includes('--remote-neon')) {
    return {valid:false,reason:'remote Neon execution is deliberately unavailable until the domain-specific independent review and release gate are merged'}
  }
  if (argv.length !== 3 || argv[0] !== '--domain' ||
      !Object.hasOwn(DOMAIN_MANIFESTS,argv[1]) || argv[2] !== '--local-only') {
    return {valid:false,reason:'select exactly: --domain D1-03|D1-04|D1-05 --local-only'}
  }
  return {valid:true,domainId:argv[1]}
}

async function runDomain(domainId) {
  const manifest = readJson(DOMAIN_MANIFESTS[domainId])
  const plan = buildDomainPlan(manifest)
  const target = validateLocalTarget(process.env.D1_SHARED_LOCAL_DATABASE_URL,manifest)
  if (!target.valid) fail(target.reason)

  const sourceCommitSha = process.env.GITHUB_SHA || process.env.REHEARSAL_SOURCE_COMMIT_SHA
  if (!SHA.test(sourceCommitSha || '')) fail('an exact source commit SHA is required for migration provenance')
  const executionId = 'local-' + (process.env.GITHUB_RUN_ID || 'manual') + '-' +
    (process.env.GITHUB_RUN_ATTEMPT || '1') + '-' + process.pid

  const { Pool } = requireFromW02('pg')
  const pool = new Pool({
    connectionString:process.env.D1_SHARED_LOCAL_DATABASE_URL,
    max:2,
    connectionTimeoutMillis:15000,
    idleTimeoutMillis:1000,
  })
  let lockClient
  let client
  let lockOpen = false
  try {
    lockClient = await pool.connect()
    await lockClient.query('BEGIN')
    lockOpen = true
    const identity = await lockClient.query(
      "SELECT current_database() AS database_name,current_setting('server_version_num')::integer AS version_num",
    )
    const major = Math.floor(Number(identity.rows[0]?.version_num) / 10000)
    if (identity.rows[0]?.database_name !== manifest.localRehearsal.databaseName || major !== 18) {
      fail('connected database must be the exact disposable PostgreSQL 18 target')
    }
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('luckread:neon-schema-migration:' || current_database(),0))",
    )

    client = await pool.connect()
    await ensureLedger(client)
    let ledgerRows = await readLedgerRows(client)
    let appliedEntries = assertLedgerPrefixRows(manifest,plan,ledgerRows)
    await verifyOwnerSchemaState(client,manifest,plan,appliedEntries.length)

    for (const item of plan.entries.slice(appliedEntries.length)) {
      for (const dependency of item.entry.dependsOn ?? []) {
        if (!appliedEntries.some((entry) => entry.migrationId === dependency)) {
          fail('migration dependency has not been committed: ' + dependency)
        }
      }
      await client.query('BEGIN')
      try {
        await client.query(item.body)
        await insertLedgerRow(client,manifest,item,sourceCommitSha,executionId)
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch {}
        throw error
      }
      appliedEntries = [...appliedEntries,item.entry]
      ledgerRows = await readLedgerRows(client)
      assertLedgerPrefixRows(manifest,plan,ledgerRows)
      await verifyOwnerSchemaState(client,manifest,plan,appliedEntries.length)
    }

    const finalRows = await readLedgerRows(client)
    assertLedgerPrefixRows(manifest,plan,finalRows)
    if (finalRows.length !== plan.entries.length) fail('shared schema executor did not commit every migration')
    const catalog = await verifyFinalCatalog(client,manifest,plan)
    const report = {
      reportType:'NEON_SHARED_DOMAIN_SCHEMA_LOCAL_POSTFLIGHT',
      status:'LOCAL_SCHEMA_ONLY_APPLY_PASS',
      domainId:manifest.domainId,
      databaseName:manifest.databaseName,
      localDatabaseName:manifest.localRehearsal.databaseName,
      postgresMajor:18,
      sourceCommitSha,
      runnerVersion,
      appliedMigrations:finalRows.map((row) => ({
        ownerWorker:row.owner_worker,
        migrationId:row.migration_id,
        migrationOrder:Number(row.migration_order),
        migrationKind:row.migration_kind,
        artifactSha256:row.artifact_sha256,
        manifestEntrySha256:row.manifest_entry_sha256,
        sourceCommitSha:row.source_commit_sha,
      })),
      catalog,
      safety:{
        remoteNeonTouched:false,
        cloudflareD1Touched:false,
        businessDataImported:false,
        runtimeBindingsChanged:false,
        productionCutoverAuthorized:false,
      },
      remoteApplyReady:false,
      remoteApplyBlockers:manifest.remoteApplyBlockers,
    }
    const output = process.env.D1_SHARED_SCHEMA_APPLY_REPORT ||
      'artifacts/neon/' + manifest.domainId.toLowerCase() + '-shared-runner-postflight.json'
    if (!isSafeRepositoryPath(output)) fail('postflight report path must remain inside the repository')
    mkdirSync(dirname(resolve(repositoryRoot,output)),{recursive:true})
    writeFileSync(resolve(repositoryRoot,output),JSON.stringify(report,null,2)+'\n')
    process.stdout.write('NEON_SHARED_DOMAIN_SCHEMA_LOCAL_PASS ' + JSON.stringify({
      domainId:manifest.domainId,
      databaseName:manifest.databaseName,
      postgresMajor:18,
      migrations:finalRows.length,
      tables:catalog.tables,
      explicitIndexes:catalog.explicitIndexes,
      triggers:catalog.triggers,
      triggerFunctions:catalog.triggerFunctions,
      foreignKeys:catalog.foreignKeys,
      businessRows:catalog.businessRows,
      remoteNeonTouched:false,
      cloudflareD1Touched:false,
      remoteApplyReady:false,
    })+'\n')
  } finally {
    if (client) client.release()
    if (lockClient) {
      if (lockOpen) {
        try { await lockClient.query('ROLLBACK') } catch {}
      }
      lockClient.release()
    }
    await pool.end()
  }
}

async function run() {
  const selection = parseCommandLine(process.argv.slice(2))
  if (!selection.valid) fail(selection.reason)
  await runDomain(selection.domainId)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
