import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = process.cwd()
const contractPath = 'contracts/database/neon-d1-02-schema-sources.v1.json'

const sqliteRules = [
  ['strftime', /\\bstrftime\\s*\\(/gi],
  ['julianday', /\\bjulianday\\s*\\(/gi],
  ['json1_function', /\\bjson_(?:object|array|extract|valid|type|set|insert|replace|remove)\\s*\\(/gi],
  ['typeof', /\\btypeof\\s*\\(/gi],
  ['glob', /\\bGLOB\\b/gi],
  ['raise', /\\bRAISE\\s*\\(/gi],
  ['pragma', /\\bPRAGMA\\b/gi],
  ['autoincrement', /\\bAUTOINCREMENT\\b/gi],
  ['randomblob', /\\brandomblob\\s*\\(/gi],
  ['datetime', /\\bdatetime\\s*\\(/gi],
  ['unixepoch', /\\bunixepoch\\s*\\(/gi],
  ['insert_or_ignore', /\\bINSERT\\s+OR\\s+IGNORE\\b/gi],
  ['insert_or_replace', /\\bINSERT\\s+OR\\s+REPLACE\\b/gi],
  ['replace_into', /\\bREPLACE\\s+INTO\\b/gi],
  ['changes_function', /\\bchanges\\s*\\(/gi],
  ['last_insert_rowid', /\\blast_insert_rowid\\s*\\(/gi],
  ['without_rowid', /\\bWITHOUT\\s+ROWID\\b/gi],
]

function countMatches(content, expression) {
  return [...content.matchAll(expression)].length
}

export function compareFileSets(expected, actual) {
  const expectedSet = [...new Set(expected)].sort()
  const actualSet = [...new Set(actual)].sort()
  return {
    missing: expectedSet.filter((item) => !actualSet.includes(item)),
    unexpected: actualSet.filter((item) => !expectedSet.includes(item)),
  }
}

export function scanSqlPortability(content) {
  const features = sqliteRules
    .map(([name, expression]) => ({ name, count: countMatches(content, expression) }))
    .filter((item) => item.count > 0)

  const triggerDefinitions = countMatches(
    content,
    /\\bCREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TRIGGER\\b/gi,
  )
  const dropTableStatements = countMatches(content, /\\bDROP\\s+TABLE\\b/gi)
  const renameTableStatements = countMatches(content, /\\bALTER\\s+TABLE\\b[^;]*\\bRENAME\\s+TO\\b/gi)
  const tableRebuildSequence = dropTableStatements > 0 && renameTableStatements > 0

  if (triggerDefinitions > 0) features.push({ name: 'trigger_definition', count: triggerDefinitions })
  if (tableRebuildSequence) features.push({ name: 'table_rebuild_sequence', count: 1 })

  const tablesCreated = [...content.matchAll(
    /\\bCREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+["`]?([A-Za-z0-9_]+)/gi,
  )].map((match) => match[1])
  const indexesCreated = [...content.matchAll(
    /\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+["`]?([A-Za-z0-9_]+)/gi,
  )].map((match) => match[1])

  return {
    tablesCreated,
    indexesCreated,
    triggerDefinitions,
    alterTableStatements: countMatches(content, /\\bALTER\\s+TABLE\\b/gi),
    dropTableStatements,
    renameTableStatements,
    sqliteSpecificFeatures: features,
    requiresManualPostgresPort: features.length > 0,
  }
}

export function validateWorkerBindings(config, owner) {
  const errors = []
  const actual = Array.isArray(config?.d1_databases) ? config.d1_databases : []
  const expected = Array.isArray(owner?.physicalBindings) ? owner.physicalBindings : []

  const actualNames = actual.map((binding) => binding.binding).sort()
  const expectedNames = expected.map((binding) => binding.binding).sort()
  const drift = compareFileSets(expectedNames, actualNames)

  if (drift.missing.length || drift.unexpected.length) {
    errors.push(
      owner.worker + ' D1 binding set drift: missing=[' + drift.missing.join(', ') +
      '], unexpected=[' + drift.unexpected.join(', ') + ']',
    )
  }

  for (const expectedBinding of expected) {
    const matches = actual.filter((item) => item.binding === expectedBinding.binding)
    if (matches.length !== 1) {
      errors.push(owner.worker + ' expected exactly one binding named ' + expectedBinding.binding)
      continue
    }
    const actualBinding = matches[0]
    if (actualBinding.database_name !== expectedBinding.databaseName) {
      errors.push(owner.worker + ' ' + expectedBinding.binding + ' database_name mismatch')
    }
    if (actualBinding.database_id !== expectedBinding.databaseUuid) {
      errors.push(owner.worker + ' ' + expectedBinding.binding + ' database_id mismatch')
    }
  }

  const included = expected.filter((item) => item.included === true)
  if (included.length !== 1 || included[0].logicalDomain !== 'D1-02') {
    errors.push(owner.worker + ' must have exactly one included D1-02 physical binding')
  }
  for (const excluded of expected.filter((item) => item.included === false)) {
    if (excluded.logicalDomain === 'D1-02') {
      errors.push(owner.worker + ' marks a D1-02 binding as excluded')
    }
  }

  return errors
}

export function buildD1_02Inventory({ contract, readSource, listSqlFiles }) {
  const failures = []
  const sourceFiles = []
  const migrationRows = []

  const addSource = (kind, relativePath, content) => {
    if (typeof content !== 'string') {
      failures.push('Missing required source: ' + relativePath)
      return
    }
    sourceFiles.push({
      kind,
      path: relativePath,
      bytes: Buffer.byteLength(content, 'utf8'),
      sha256: createHash('sha256').update(content).digest('hex'),
    })
  }

  for (const owner of contract.owners) {
    const actualFiles = listSqlFiles(owner.migrationDirectory).sort()
    const expectedFiles = [...owner.sqlMigrations].sort()
    const drift = compareFileSets(expectedFiles, actualFiles)
    if (drift.missing.length || drift.unexpected.length) {
      failures.push(
        owner.worker + ' migration file drift: missing=[' + drift.missing.join(', ') +
        '], unexpected=[' + drift.unexpected.join(', ') + ']',
      )
    }

    const wranglerContent = readSource(owner.wrangler)
    addSource('wrangler-config', owner.wrangler, wranglerContent)
    if (wranglerContent !== null) {
      try {
        const config = JSON.parse(wranglerContent)
        failures.push(...validateWorkerBindings(config, owner))
      } catch (error) {
        failures.push(owner.worker + ' Wrangler config is not valid JSON: ' + String(error))
      }
    }

    for (const referencePath of owner.referenceContracts ?? []) {
      addSource('domain-contract-reference', referencePath, readSource(referencePath))
    }

    for (const fileName of owner.sqlMigrations) {
      const relativePath = path.posix.join(owner.migrationDirectory, fileName)
      const content = readSource(relativePath)
      addSource('sqlite-migration-source', relativePath, content)
      if (content === null) continue

      migrationRows.push({
        ownerWorker: owner.worker,
        path: relativePath,
        sha256: createHash('sha256').update(content).digest('hex'),
        bytes: Buffer.byteLength(content, 'utf8'),
        ...scanSqlPortability(content),
      })
    }
  }

  sourceFiles.sort((a, b) => a.path.localeCompare(b.path))
  migrationRows.sort((a, b) => a.path.localeCompare(b.path))

  const featureCounts = {}
  for (const migration of migrationRows) {
    for (const feature of migration.sqliteSpecificFeatures) {
      featureCounts[feature.name] = (featureCounts[feature.name] ?? 0) + feature.count
    }
  }

  const report = {
    reportType: 'LUCKREAD_NEON_D1_02_SCHEMA_SOURCE_INVENTORY',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceCommitSha: process.env.GITHUB_SHA ?? null,
    contractPath,
    target: contract.target,
    status: failures.length === 0
      ? 'SOURCE_INVENTORY_VALID_PORTABILITY_REVIEW_REQUIRED'
      : 'SOURCE_INVENTORY_DRIFT',
    safety: {
      neonConnectionAttempted: false,
      remoteDdlExecuted: false,
      productionD1Touched: false,
      workerRuntimeOrBindingChanged: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
    },
    ownerSummaries: contract.owners.map((owner) => ({
      worker: owner.worker,
      migrationDirectory: owner.migrationDirectory,
      migrationCount: owner.sqlMigrations.length,
      includedBindings: owner.physicalBindings.filter((item) => item.included).map((item) => item.binding),
      excludedBindings: owner.physicalBindings.filter((item) => !item.included).map((item) => ({
        binding: item.binding,
        logicalDomain: item.logicalDomain,
        reason: item.reason,
      })),
    })),
    migrationSummary: {
      migrationCount: migrationRows.length,
      filesRequiringManualPostgresPort: migrationRows
        .filter((item) => item.requiresManualPostgresPort).length,
      featureCounts,
    },
    knownHistoricalContractPathDiscrepancies: contract.knownHistoricalContractPathDiscrepancies,
    portabilityReviewRequirements: contract.portabilityReviewRequirements,
    sourceFiles,
    migrations: migrationRows,
    failures,
  }

  return { report, failures }
}

function readRequiredSource(relativePath) {
  try {
    return readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
  } catch {
    return null
  }
}

function listSqlFiles(relativeDirectory) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory)
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(absolute)
      else if (entry.isFile() && entry.name.endsWith('.sql')) {
        files.push(path.relative(absoluteDirectory, absolute).split(path.sep).join('/'))
      }
    }
  }
  walk(absoluteDirectory)
  return files.sort()
}

function run() {
  const contract = JSON.parse(readRequiredSource(contractPath) ?? 'null')
  if (!contract || contract.target?.domainId !== 'D1-02' || contract.target?.databaseName !== 'luckreadpro') {
    throw new Error('D1-02 source inventory contract is missing or targets an unexpected database')
  }

  const { report, failures } = buildD1_02Inventory({
    contract,
    readSource: readRequiredSource,
    listSqlFiles,
  })

  const reportArgument = process.argv.indexOf('--report')
  if (reportArgument >= 0) {
    const reportPath = process.argv[reportArgument + 1]
    if (!reportPath) throw new Error('--report requires an output path')
    mkdirSync(path.dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    run()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
