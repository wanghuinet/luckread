import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const requireFromW02 = createRequire(resolve(repositoryRoot, 'workers/W02-identity/package.json'))
const { Pool } = requireFromW02('pg')

const fail = (message) => {
  throw new Error('D1-01 combined local rehearsal: ' + message)
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const manifestPath = resolve(repositoryRoot, 'contracts/database/neon-d1-01-migration-manifest.v1.json')
const manifest = readJson(manifestPath)

const relationPattern = String.raw`(?:(?:"public"|public)\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?`

export function extractTouchedTables(sql) {
  const names = new Set()
  const patterns = [
    new RegExp(String.raw`\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${relationPattern}`, 'gi'),
    new RegExp(String.raw`\bALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?${relationPattern}`, 'gi'),
  ]
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) names.add(match[1])
  }
  return [...names].sort()
}

export function assertSameOwnerForeignKeys(ownerByTable, foreignKeys) {
  const violations = foreignKeys.filter((item) =>
    !ownerByTable.has(item.sourceTable) ||
    !ownerByTable.has(item.targetTable) ||
    ownerByTable.get(item.sourceTable) !== ownerByTable.get(item.targetTable)
  )
  if (violations.length > 0) {
    fail('foreign keys must remain within one Worker-owned schema slice: ' +
      violations.map((item) => item.sourceTable + ' -> ' + item.targetTable).join(', '))
  }
}

function readManifestChecksums() {
  const validator = resolve(repositoryRoot, 'scripts/neon/d1-01-migration-manifest.mjs')
  const result = spawnSync(process.execPath, [validator, '--print-checksums'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error || result.status !== 0) {
    fail('canonical manifest/checksum validation failed: ' +
      (result.stderr || result.error?.message || 'unknown validator error').trim())
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    fail('manifest checksum validator did not return JSON')
  }
}

function collectOwnerTables() {
  const owners = new Set(manifest.entries.map((entry) => entry.ownerWorker))
  if (JSON.stringify([...owners].sort()) !== JSON.stringify(['W01', 'W02', 'W07', 'W08'])) {
    fail('manifest owner set must remain exactly W01/W02/W07/W08')
  }
  const ownerByTable = new Map()
  for (const entry of manifest.entries) {
    if (entry.artifactState !== 'COMMITTED') {
      fail('all D1-01 artifacts must be committed before the integrated rehearsal: ' + entry.migrationId)
    }
    for (const relativePath of entry.artifactPaths) {
      if (!relativePath.endsWith('.sql') && !relativePath.endsWith('.ts')) continue
      const sql = readFileSync(resolve(repositoryRoot, relativePath), 'utf8')
      for (const table of extractTouchedTables(sql)) {
        const existingOwner = ownerByTable.get(table)
        if (existingOwner && existingOwner !== entry.ownerWorker) {
          fail('table ownership collision: ' + table + ' is declared by ' +
            existingOwner + ' and ' + entry.ownerWorker)
        }
        ownerByTable.set(table, entry.ownerWorker)
      }
    }
  }
  for (const table of ['users', 'user', 'membership_subscriptions', 'creator_applications']) {
    if (!ownerByTable.has(table)) fail('expected owner table is not derived from committed artifacts: ' + table)
  }
  ownerByTable.set('neon_schema_migration_ledger', 'MIGRATION_LEDGER')
  return ownerByTable
}

function assertManifestAndChecksums(checksums) {
  if (manifest.domainId !== 'D1-01' || manifest.databaseName !== 'luckread' ||
      manifest.postgresMajor !== 18 || manifest.businessDataImport !== false ||
      manifest.productionCutoverAuthorized !== false ||
      manifest.entries.length !== 14) {
    fail('manifest target, schema-only authorization or 14-entry contract drifted')
  }
  if (!Array.isArray(checksums) || checksums.length !== manifest.entries.length) {
    fail('exactly one verified artifact/manifest checksum is required per entry')
  }
  const byId = new Map(checksums.map((item) => [item.migrationId, item]))
  for (const entry of manifest.entries) {
    const checksum = byId.get(entry.migrationId)
    if (!checksum || !/^[0-9a-f]{64}$/.test(checksum.artifactSha256) ||
        !/^[0-9a-f]{64}$/.test(checksum.manifestEntrySha256)) {
      fail('committed artifact and manifest checksum required for ' + entry.migrationId)
    }
  }
}

async function run() {
  const connectionString = process.env.W02_SCHEMA_DATABASE_URL
  if (!connectionString) fail('W02_SCHEMA_DATABASE_URL is required')
  const parsedUrl = new URL(connectionString)
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(parsedUrl.hostname) ||
      parsedUrl.port !== '5432' || parsedUrl.pathname !== '/luckread_schema') {
    fail('only the disposable local PostgreSQL 18 luckread_schema target is allowed')
  }

  const sourceCommitSha = process.env.REHEARSAL_SOURCE_COMMIT_SHA || process.env.GITHUB_SHA
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceCommitSha || '')) {
    fail('an exact Git source commit SHA is required for rehearsal ledger provenance')
  }
  const checksums = readManifestChecksums()
  assertManifestAndChecksums(checksums)
  const checksumById = new Map(checksums.map((item) => [item.migrationId, item]))
  const ownerByTable = collectOwnerTables()
  const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 5_000 })

  try {
    const identity = await pool.query(
      "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
    )
    const postgresMajor = Math.floor(Number(identity.rows[0].version_num) / 10_000)
    if (identity.rows[0].database_name !== 'luckread_schema' || postgresMajor !== 18) {
      fail('expected disposable PostgreSQL 18 database luckread_schema')
    }

    const actual = await pool.query(
      "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    )
    const actualTables = actual.rows.map((row) => row.tablename)
    const expectedTables = [...ownerByTable.keys()].sort()
    const missingTables = expectedTables.filter((name) => !actualTables.includes(name))
    const unexpectedTables = actualTables.filter((name) => !ownerByTable.has(name))
    if (missingTables.length || unexpectedTables.length) {
      fail('combined schema table union drifted; missing=[' + missingTables.join(',') +
        '] unexpected=[' + unexpectedTables.join(',') + ']')
    }

    const foreignKeyResult = await pool.query(
      `SELECT source.relname AS source_table, target.relname AS target_table
         FROM pg_constraint constraint_row
         JOIN pg_class source ON source.oid = constraint_row.conrelid
         JOIN pg_namespace source_schema ON source_schema.oid = source.relnamespace
         JOIN pg_class target ON target.oid = constraint_row.confrelid
         JOIN pg_namespace target_schema ON target_schema.oid = target.relnamespace
        WHERE constraint_row.contype = 'f'
          AND source_schema.nspname = 'public'
          AND target_schema.nspname = 'public'
        ORDER BY source.relname, target.relname`,
    )
    const foreignKeys = foreignKeyResult.rows.map((row) => ({
      sourceTable: row.source_table,
      targetTable: row.target_table,
    }))
    assertSameOwnerForeignKeys(ownerByTable, foreignKeys)

    const ledgerResult = await pool.query(
      'SELECT domain_id, database_name, owner_worker, migration_id, migration_order, migration_kind, ' +
      'artifact_sha256, manifest_entry_sha256, source_commit_sha, runner_version, execution_id ' +
      'FROM neon_schema_migration_ledger WHERE domain_id = $1 ORDER BY migration_order',
      ['D1-01'],
    )
    if (ledgerResult.rows.length !== manifest.entries.length) {
      fail('shared runner ledger must contain exactly fourteen D1-01 migration rows')
    }
    for (let i = 0; i < manifest.entries.length; i++) {
      const entry = manifest.entries[i]
      const checksum = checksumById.get(entry.migrationId)
      const row = ledgerResult.rows[i]
      if (row.domain_id !== 'D1-01' || row.database_name !== 'luckread' ||
          row.migration_id !== entry.migrationId || Number(row.migration_order) !== entry.order ||
          row.owner_worker !== entry.ownerWorker || row.migration_kind !== entry.kind ||
          row.artifact_sha256 !== checksum.artifactSha256 ||
          row.manifest_entry_sha256 !== checksum.manifestEntrySha256 ||
          row.source_commit_sha !== sourceCommitSha ||
          row.runner_version !== 'd1-01-shared-runner/1.0.0') {
        fail('shared runner ledger provenance row does not match manifest/checksums: ' + entry.migrationId)
      }
    }

    const businessRows = {}
    for (const table of expectedTables) {
      if (table === 'payload_migrations' || table === 'neon_schema_migration_ledger') continue
      const result = await pool.query('SELECT COUNT(*)::bigint AS count FROM public."' +
        table.replace(/"/g, '""') + '"')
      const count = Number(result.rows[0].count)
      businessRows[table] = count
      if (count !== 0) fail('business table unexpectedly contains rows: ' + table + ' (' + count + ')')
    }
    const payloadMigrationCount = await pool.query(
      'SELECT COUNT(*)::integer AS count FROM public.payload_migrations',
    )
    if (Number(payloadMigrationCount.rows[0].count) !== 1) {
      fail('Payload must record exactly its one schema migration in payload_migrations')
    }

    const evidence = {
      status: 'D1_01_FULL_LOCAL_POSTGRES18_REHEARSAL_PASS',
      target: { host: parsedUrl.hostname, database: 'luckread_schema', postgresMajor },
      sourceCommitSha,
      manifestEntries: manifest.entries.length,
      ownerWorkers: ['W01', 'W02', 'W07', 'W08'],
      tableCount: actualTables.length,
      tablesByOwner: Object.fromEntries(
        ['W01', 'W02', 'W07', 'W08'].map((owner) => [
          owner, [...ownerByTable].filter(([, tableOwner]) => tableOwner === owner).map(([table]) => table).sort(),
        ]),
      ),
      foreignKeyCount: foreignKeys.length,
      crossOwnerForeignKeys: 0,
      ledgerRows: ledgerResult.rows.length,
      payloadMigrationRows: Number(payloadMigrationCount.rows[0].count),
      businessRows: businessRows,
      businessDataImported: false,
      remoteNeonConnectionAttempted: false,
      productionD1Touched: false,
      productionCutoverAuthorized: false,
    }
    const reportPath = resolve(repositoryRoot,
      process.env.D1_01_REHEARSAL_REPORT || 'artifacts/neon/d1-01-full-local-rehearsal.json')
    mkdirSync(dirname(reportPath), { recursive: true })
    writeFileSync(reportPath, JSON.stringify(evidence, null, 2) + '\n')
    process.stdout.write(JSON.stringify(evidence, null, 2) + '\n')
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
