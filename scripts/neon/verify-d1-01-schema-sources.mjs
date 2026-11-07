import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const contractPath = 'contracts/database/neon-d1-01-schema-sources.v1.json'
const contract = JSON.parse(readFileSync(path.join(root, contractPath), 'utf8'))
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

for (const [owner, dir, expectedFiles] of [
  ['W02', 'workers/W02-identity/migrations', [...expected.w02BuiltIn, ...expected.w02Custom]],
  ['W07', 'workers/W07-subscription-commerce/migrations', expected.w07],
  ['W08', 'workers/W08-creator/migrations', expected.w08],
]) {
  const actual = listFiles(dir, '.sql')
  compareSets(`${owner} D1-01 SQL migrations`, actual, expectedFiles)
  for (const file of expectedFiles) scanSql(`${dir}/${file}`, owner)
}

const payload = contract.owners[0]
for (const file of [
  payload.config,
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
    if (tables.length !== payload.expectedCurrentCollectionTables) {
      failures.push(`W01 latest SQLite schema snapshot expected ${payload.expectedCurrentCollectionTables} tables, found ${tables.length}`)
    }
  }
  if (file === payload.config) {
    if (!content.includes('@payloadcms/db-d1-sqlite')) failures.push('W01 current Payload adapter no longer matches the source contract')
    if (!/push\s*:\s*false/.test(content)) failures.push('W01 Payload push:false was not found; do not admit automatic production DDL')
  }
  addSource('W01', file.endsWith('.json') ? 'sqlite-schema-snapshot' : file.includes('/collections/') ? 'payload-collection' : 'payload-config-or-wrangler', file, content, extra)
}

for (const owner of contract.owners.slice(1)) {
  const content = read(owner.config)
  if (content !== null) {
    if (owner.worker === 'W02') {
      if (!content.includes('database: env.D1_01')) failures.push('W02 Better Auth no longer binds the expected D1-01 source database')
      addSource('W02', 'better-auth-config', owner.config, content)
    }
  }
  const wrangler = read(owner.wrangler)
  if (wrangler !== null) {
    if (!wrangler.includes('"database_name": "luckread"') || !wrangler.includes('"database_id": "2f80471e-3756-49f9-8db1-7707a433ad64"')) {
      failures.push(`${owner.worker} Wrangler D1-01 database mapping drifted from the admitted physical source`)
    }
    addSource(owner.worker, 'wrangler-database-mapping', owner.wrangler, wrangler)
  }
}

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
    w02SqlMigrations: expected.w02BuiltIn.length + expected.w02Custom.length,
    w07D101SqlMigrations: expected.w07.length,
    w08SqlMigrations: expected.w08.length,
    totalSqlMigrationFiles: sourceRows.filter((row) => row.kind === 'sql-migration').length,
    directD1RuntimeFiles: Object.fromEntries(Object.entries(directD1Code).map(([key, values]) => [key, values.length])),
    totalFingerprintedFiles: sourceRows.length,
  },
  directD1RuntimeFiles: directD1Code,
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
