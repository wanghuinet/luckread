import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contractPath = 'contracts/database/neon-d1-01-schema-sources.v1.json'
const contract = JSON.parse(readFileSync(path.join(root, contractPath), 'utf8'))
const boundaryContract = JSON.parse(readFileSync(path.join(root, 'contracts/transport/worker-d1-access-boundary.v1.json'), 'utf8'))
const financeSourceContract = JSON.parse(readFileSync(path.join(root, 'contracts/database/neon-d1-04-w07-order-payment-schema.v1.json'), 'utf8'))
const failures = []
const sourceRows = []

const read = (relativePath) => {
  const fullPath = path.join(root, relativePath)
  if (!statSafe(fullPath)) {
    failures.push(`Missing required source: ${relativePath}`)
    return null
  }
  return readFileSync(fullPath, 'utf8')
}

function statSafe(fullPath) {
  try { return statSync(fullPath).isFile() } catch { return false }
}

function listFiles(relativeDir, extension) {
  const fullDir = path.join(root, relativeDir)
  if (!statSafe(path.join(fullDir, '.')) && !existsDir(fullDir)) {
    failures.push(`Missing source directory: ${relativeDir}`)
    return []
  }
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && entry.name.endsWith(extension)) {
        found.push(path.relative(fullDir, absolute).split(path.sep).join('/'))
      }
    }
  }
  walk(fullDir)
  return found.sort()
}

function existsDir(fullPath) {
  try { return statSync(fullPath).isDirectory() } catch { return false }
}

function addSource(owner, kind, relativePath, content, extra = {}) {
  if (content === null) return
  sourceRows.push({
    owner,
    kind,
    path: relativePath,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
    ...extra,
  })
}

function compareSets(label, actual, expected) {
  const a = [...actual].sort()
  const e = [...expected].sort()
  const missing = e.filter((item) => !a.includes(item))
  const unexpected = a.filter((item) => !e.includes(item))
  if (missing.length || unexpected.length) {
    failures.push(`${label} drift: missing=[${missing.join(', ')}], unexpected=[${unexpected.join(', ')}]`)
  }
}

const sqliteRules = [
  ['strftime', /\bstrftime\s*\(/gi],
  ['julianday', /\bjulianday\s*\(/gi],
  ['json_valid', /\bjson_valid\s*\(/gi],
  ['json_type', /\bjson_type\s*\(/gi],
  ['typeof', /\btypeof\s*\(/gi],
  ['GLOB', /\bGLOB\b/gi],
  ['RAISE_ABORT', /\bRAISE\s*\(\s*ABORT/gi],
  ['PRAGMA', /\bPRAGMA\b/gi],
  ['AUTOINCREMENT', /\bAUTOINCREMENT\b/gi],
]

function scanSql(relativePath, owner) {
  const content = read(relativePath)
  if (content === null) return
  const constructs = []
  for (const [name, expression] of sqliteRules) {
    const count = [...content.matchAll(expression)].length
    if (count > 0) constructs.push({ name, count })
  }
  const triggers = [...content.matchAll(/\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/gi)].length
  addSource(owner, 'sql-migration', relativePath, content, {
    sqliteSpecificConstructs: constructs,
    triggerDefinitions: triggers,
    requiresManualPostgresPort: constructs.length > 0 || triggers > 0,
  })
}

const expected = {
  w01PayloadModules: contract.owners[0].migrationModules,
  w02BuiltIn: contract.owners[1].builtInSchemaMigrations,
  w02Custom: contract.owners[1].customSqlMigrations,
  w07: contract.owners[2].sqlMigrations,
  w08: contract.owners[3].sqlMigrations,
}

const payloadTsDir = 'workers/W01-payload/src/migrations'
const payloadModules = listFiles(payloadTsDir, '.ts').filter((name) => name !== 'index.ts')
compareSets('W01 Payload migration modules', payloadModules, expected.w01PayloadModules)

const migrationIndex = read(contract.owners[0].migrationIndex)
if (migrationIndex !== null) {
  const imports = [...migrationIndex.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g)]
    .map((match) => `${match[1]}.ts`)
  compareSets('W01 migration index imports', imports, expected.w01PayloadModules)
  addSource('W01', 'payload-migration-index', contract.owners[0].migrationIndex, migrationIndex)
}

const w02Directory = 'workers/W02-identity/migrations'
const w02Actual = listFiles(w02Directory, '.sql')
compareSets('W02 D1-01 SQL migrations', w02Actual, [...expected.w02BuiltIn, ...expected.w02Custom])
for (const file of expected.w02BuiltIn) {
  const relativePath = `${w02Directory}/${file}`
  const content = read(relativePath)
  if (content !== null) {
    const tableNames = [...content.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+["`]?([A-Za-z0-9_]+)/gi)]
      .map((match) => match[1])
    addSource('W02', 'better-auth-schema-reference-only', relativePath, content, {
      tableNames,
      executionPolicy: 'Do not execute this SQLite migration on PostgreSQL; generate Better Auth schema from the pinned config/CLI.',
    })
  }
}
const betterAuthTableNames = sourceRows
  .filter((row) => row.owner === 'W02' && row.kind === 'better-auth-schema-reference-only')
  .flatMap((row) => row.tableNames ?? [])
  .sort()
compareSets('W02 Better Auth core/plugin table definitions', betterAuthTableNames, contract.owners[1].expectedBetterAuthTables)

for (const file of expected.w02Custom) scanSql(`${w02Directory}/${file}`, 'W02')

for (const [owner, dir, expectedFiles] of [
  ['W07', 'workers/W07-subscription-commerce/migrations', expected.w07],
  ['W08', 'workers/W08-creator/migrations', expected.w08],
]) {
  const actual = listFiles(dir, '.sql')
  compareSets(`${owner} D1-01 SQL migrations`, actual, expectedFiles)
  for (const file of expectedFiles) scanSql(`${dir}/${file}`, owner)
}

const payload = contract.owners[0]
for (const module of expected.w01PayloadModules) {
  const relativePath = `${payloadTsDir}/${module}`
  const content = read(relativePath)
  addSource('W01', 'payload-d1-migration-reference-only', relativePath, content, {
    executionPolicy: 'Do not execute D1 adapter migration modules on PostgreSQL; regenerate a PostgreSQL-native baseline from the official Payload Postgres adapter.',
  })
}

for (const file of [
  payload.config,
  payload.postgresAdapter,
  payload.productionWrangler,
  payload.wrangler,
  ...payload.collections,
  ...payload.sqliteSchemaSnapshots,
]) {
  const content = read(file)
  if (content === null) continue
  let extra = {}
  if (file.endsWith('.json') && file === payload.latestSqliteSnapshot) {
    const snapshot = JSON.parse(content)
    const tables = Object.keys(snapshot.tables ?? {})
    const columns = tables.reduce((total, table) =>
      total + Object.keys(snapshot.tables[table].columns ?? {}).length, 0)
    extra = {
      dialect: snapshot.dialect,
      tableCount: tables.length,
      columnCount: columns,
      tableNames: tables,
    }
    compareSets('W01 latest Payload SQLite table catalog', tables, payload.expectedCurrentTableNames)
  }
  if (file === payload.config) {
    if (!content.includes('createW01NeonPostgresAdapter')) failures.push('W01 active Payload config must use the Neon PostgreSQL adapter')
    if (content.includes('sqliteD1Adapter')) failures.push('W01 active Payload config must not retain a D1/SQLite runtime adapter')
  }
  if (file === payload.postgresAdapter && !/push\s*:\s*false/.test(content)) failures.push('W01 Neon PostgreSQL adapter must keep push:false; do not admit automatic production DDL')
  if (file === payload.wrangler) {
    let config
    try { config = JSON.parse(content) } catch {
      failures.push('W01 historical Wrangler source config is invalid JSON')
    }
    if ((config?.d1_databases ?? []).length !== 0) {
      failures.push('W01 active Wrangler runtime config must not bind Cloudflare D1')
    }
  }
  addSource('W01', file.endsWith('.json') ? 'sqlite-schema-snapshot' : file.includes('/collections/') ? 'payload-collection' : 'payload-config-or-wrangler', file, content, extra)
}

for (const owner of contract.owners.slice(1)) {
  if (owner.config) {
    const content = read(owner.config)
    if (content !== null && owner.worker === 'W02') {
      if (!/export\s+const\s+buildLuckReadAuth/.test(content)) {
        failures.push('W02 Better Auth canonical configuration entrypoint is missing')
      }
      addSource('W02', 'better-auth-config', owner.config, content)
    }
  }

  const wrangler = read(owner.wrangler)
  if (wrangler !== null) {
    let sourceConfig
    try { sourceConfig = JSON.parse(wrangler) } catch {
      failures.push(`${owner.worker} historical Wrangler source config is invalid JSON`)
    }
    if (sourceConfig && owner.worker === 'W02') {
      if ((sourceConfig.d1_databases ?? []).length !== 0) {
        failures.push('W02 active Wrangler runtime config must not bind Cloudflare D1')
      }
    }
    if (sourceConfig && owner.worker === 'W07') {
      const sourceMembershipUuid = boundaryContract.physicalD1Registry?.['D1-01']
      const sourceFinanceUuid = financeSourceContract.target?.cloudflareD1DatabaseUuid
      const sourceMigrations = financeSourceContract.scope?.includedSourceMigrations ?? []
      const hyperdrive = sourceConfig.hyperdrive ?? []
      if (sourceMembershipUuid !== '2f80471e-3756-49f9-8db1-7707a433ad64' ||
          financeSourceContract.target?.binding !== 'D1_04' ||
          sourceFinanceUuid !== '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' ||
          sourceConfig.d1_databases?.length > 0 ||
          sourceConfig.vars?.W07_DATABASE_DRIVER !== 'neon' ||
          sourceConfig.vars?.W07_MEMBERSHIP_DATABASE_DRIVER !== 'neon' ||
          !hyperdrive.some((binding) => binding.binding === 'HYPERDRIVE_MEMBERSHIP_DB' && binding.id === '0c53a1bb9bc0484bac146e8ae2d3158b') ||
          !hyperdrive.some((binding) => binding.binding === 'HYPERDRIVE_FINANCE_DB' && binding.id === '3ae15e6dfb5e4b44979eee30e1d5ede4') ||
          sourceMigrations.length !== 7 ||
          sourceMigrations.some((source) => !statSafe(path.join(root, source)))) {
        failures.push('W07 historical D1-01/D1-04 source identities must remain pinned to their migration contracts and runtime config must remain Neon-only')
      }
    }
    const sourceKind = owner.worker === 'W07' ? 'wrangler-neon-runtime-config' : 'wrangler-historical-source-mapping'
    addSource(owner.worker, sourceKind, owner.wrangler, wrangler)
  }
}


function validateNeonProductionConfig(worker, relativePath, expected) {
  const content = read(relativePath)
  if (content === null) return
  let config
  try { config = JSON.parse(content) } catch {
    failures.push(`${worker} Neon production Wrangler config is invalid JSON`)
    return
  }
  const validBase = config.name === expected.name &&
    (config.d1_databases ?? []).length === 0 &&
    config.vars?.[expected.driver] === 'neon' &&
    (config.hyperdrive ?? []).some((binding) =>
      binding.binding === expected.binding && binding.id === expected.hyperdriveId)
  let validTopology = true
  if (worker === 'W02') {
    validTopology =
      (config.queues?.producers ?? []).some((binding) =>
        binding.binding === 'AUTH013_QUEUE' && binding.queue === 'luckread-auth013-account-state') &&
      (config.queues?.producers ?? []).some((binding) =>
        binding.binding === 'AUTH013_PROJECTION_QUEUE' && binding.queue === 'luckread-auth013-account-state-projection')
  }
  if (worker === 'W07') {
    validTopology =
      config.vars?.W07_MEMBERSHIP_DATABASE_DRIVER === 'neon' &&
      (config.hyperdrive ?? []).some((binding) =>
        binding.binding === 'HYPERDRIVE_MEMBERSHIP_DB' && binding.id === '0c53a1bb9bc0484bac146e8ae2d3158b') &&
      (config.hyperdrive ?? []).some((binding) =>
        binding.binding === 'HYPERDRIVE_FINANCE_DB' && binding.id === '3ae15e6dfb5e4b44979eee30e1d5ede4') &&
      (config.services ?? []).some((binding) =>
        binding.binding === 'W06_GOVERNANCE' && binding.service === 'luckread-w06')
  }
  if (!validBase || !validTopology) {
    failures.push(`${worker} production config must be D1-free and preserve its approved Neon Hyperdrive/Worker topology`)
  }
  addSource(worker, 'wrangler-neon-production-runtime', relativePath, content, {
    productionD1BindingCount: (config.d1_databases ?? []).length,
    databaseDriver: config.vars?.[expected.driver] ?? null,
  })
}

validateNeonProductionConfig('W01', 'workers/W01-payload/wrangler.neon.jsonc', {
  name: 'luckread-w01-payload',
  driver: 'PAYLOAD_DATABASE_DRIVER',
  binding: 'HYPERDRIVE',
  hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
})
validateNeonProductionConfig('W02', 'workers/W02-identity/wrangler.neon.jsonc', {
  name: 'luckread-w02',
  driver: 'W02_DATABASE_DRIVER',
  binding: 'HYPERDRIVE',
  hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
})
validateNeonProductionConfig('W07', 'workers/W07-subscription-commerce/wrangler.neon.jsonc', {
  name: 'luckread-w07',
  driver: 'W07_DATABASE_DRIVER',
  binding: 'HYPERDRIVE_MEMBERSHIP_DB',
  hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
})
validateNeonProductionConfig('W08', 'workers/W08-creator/wrangler.jsonc', {
  name: 'luckread-w08-creator',
  driver: 'W08_DATABASE_DRIVER',
  binding: 'HYPERDRIVE',
  hyperdriveId: '0c53a1bb9bc0484bac146e8ae2d3158b',
})

// Audit application files that contain direct D1 operations. This does not port
// runtime code; it prevents schema-only work from being mistaken for adapter completion.
const directD1Code = {}
for (const owner of ['W02', 'W07', 'W08']) {
  const directory = owner === 'W02' ? 'workers/W02-identity/src'
    : owner === 'W07' ? 'workers/W07-subscription-commerce/src'
      : 'workers/W08-creator/src'
  const files = listFiles(directory, '.ts')
  const matches = []
  for (const relativeFile of files) {
    const fullPath = path.join(directory, relativeFile)
    const content = readFileSync(fullPath, 'utf8')
    if (/\bD1Database\b|\bD1_01\b|\.prepare\s*\(|\.batch\s*\(/.test(content)) {
      matches.push(path.posix.join(directory, relativeFile))
      addSource(owner, 'runtime-d1-access-audit', path.posix.join(directory, relativeFile), content)
    }
  }
  directD1Code[owner] = matches
}

// Record package/adapter versions. The target adapters are deliberately not
// considered installed by this inventory-only step.
const w01Package = JSON.parse(read('workers/W01-payload/package.json'))
const w02Package = JSON.parse(read('workers/W02-identity/package.json'))
const packageState = {
  payloadVersion: w01Package.dependencies?.payload ?? null,
  payloadD1Adapter: w01Package.dependencies?.['@payloadcms/db-d1-sqlite'] ?? null,
  payloadPostgresAdapterInstalled: Boolean(w01Package.dependencies?.['@payloadcms/db-postgres']),
  betterAuthVersion: w02Package.dependencies?.['better-auth'] ?? null,
  betterAuthPgDriverInstalled: Boolean(w02Package.dependencies?.pg),
}

const directD1CodeBreakdown = Object.fromEntries(
  Object.entries(directD1Code).map(([owner, files]) => {
    const tests = files.filter((file) => file.endsWith('.test.ts'))
    const production = files.filter((file) => !file.endsWith('.test.ts'))
    return [owner, { productionSourceFiles: production.length, testFiles: tests.length, total: files.length }]
  }),
)

const sqliteFindings = sourceRows
  .filter((row) => row.kind === 'sql-migration' && (row.sqliteSpecificConstructs?.length || row.triggerDefinitions))
  .map((row) => ({
    owner: row.owner,
    path: row.path,
    constructs: row.sqliteSpecificConstructs,
    triggerDefinitions: row.triggerDefinitions,
  }))

const report = {
  reportVersion: 1,
  domainId: contract.target.domainId,
  targetDatabase: contract.target.databaseName,
  status: failures.length === 0 ? 'SOURCE_INVENTORY_PASS' : 'SOURCE_INVENTORY_FAIL',
  scope: 'Source inventory only. No PostgreSQL DDL, remote connection, Worker switch, or business-data operation is performed.',
  productionAuthority: contract.target.existingProductionAuthority,
  businessDataImport: false,
  targetDdlWritten: false,
  remoteConnectionAttempted: false,
  packageState,
  sourceCounts: {
    w01PayloadMigrationModules: payloadModules.length,
    w02SqlMigrationReferences: expected.w02BuiltIn.length + expected.w02Custom.length,
    w02CustomSqlMigrationsToPort: expected.w02Custom.length,
    w07D101SqlMigrations: expected.w07.length,
    w08SqlMigrations: expected.w08.length,
    totalCustomSqlMigrationFilesToPort: sourceRows.filter((row) => row.kind === 'sql-migration').length,
    directD1RuntimeFiles: directD1CodeBreakdown,
    totalFingerprintedFiles: sourceRows.length,
  },
  directD1RuntimeFiles: directD1Code,
  directD1RuntimeFileBreakdown: directD1CodeBreakdown,
  sqlitePortabilityFindings: sqliteFindings,
  sources: sourceRows.sort((a, b) => a.path.localeCompare(b.path)),
  failures,
}

const reportFlag = process.argv.indexOf('--report')
if (reportFlag >= 0) {
  const reportPath = process.argv[reportFlag + 1]
  if (!reportPath) throw new Error('--report requires a file path')
  mkdirSync(path.dirname(path.join(root, reportPath)), { recursive: true })
  writeFileSync(path.join(root, reportPath), `${JSON.stringify(report, null, 2)}\n`)
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (failures.length > 0) process.exitCode = 1
