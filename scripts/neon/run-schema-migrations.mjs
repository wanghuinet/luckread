import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import tls from 'node:tls'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const requireFromW02 = createRequire(resolve(repositoryRoot, 'workers/W02-identity/package.json'))
const { Pool } = requireFromW02('pg')

const fail = (message) => { throw new Error('D1-01 shared schema runner: ' + message) }
const readJson = (path) => JSON.parse(readFileSync(resolve(repositoryRoot, path), 'utf8'))
const manifest = readJson('contracts/database/neon-d1-01-migration-manifest.v1.json')
const ledgerContract = readJson('contracts/database/neon-schema-migration-ledger.v1.json')
const ledgerSqlPath = 'scripts/neon/d1-01/0001_schema_migration_ledger.sql'
const runnerVersion = 'd1-01-shared-runner/1.0.0'

export function validateLocalTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, reason: 'D1_01_LOCAL_DATABASE_URL is required' }
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return { valid: false, reason: 'database URL is invalid' }
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', 'localhost', 'postgres'].includes(parsed.hostname) ||
      parsed.port !== '5432' || parsed.pathname !== '/luckread_schema') {
    return { valid: false, reason: 'runner is local-only and accepts only PostgreSQL luckread_schema on port 5432' }
  }
  if (!parsed.username || !parsed.password) {
    return { valid: false, reason: 'local PostgreSQL credentials are required' }
  }
  return { valid: true, parsed }
}

export function validateRemoteNeonTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, reason: 'NEON_DATABASE_URL_LUCKREAD is required' }
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return { valid: false, reason: 'Neon database URL is invalid' }
  }
  const hostname = parsed.hostname.toLowerCase()
  const database = (() => {
    try { return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) } catch { return '' }
  })()
  const approvedNeonHost = /^ep-[a-z0-9-]+(?:\.c-\d+)?(?:\.[a-z0-9-]+\.aws)?\.neon\.tech$/.test(hostname)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !approvedNeonHost || !['', '5432'].includes(parsed.port) || database !== 'luckread') {
    return { valid: false, reason: 'remote runner accepts only the approved Neon PostgreSQL 18 database luckread' }
  }
  if (parsed.searchParams.getAll('sslmode').length !== 1 ||
      !['require', 'verify-full'].includes(parsed.searchParams.get('sslmode')) ||
      parsed.searchParams.getAll('channel_binding').length !== 1 ||
      parsed.searchParams.get('channel_binding') !== 'require') {
    return { valid: false, reason: 'Neon connection must use sslmode=require or verify-full with channel_binding=require' }
  }
  if (!parsed.username || !parsed.password) {
    return { valid: false, reason: 'Neon database credentials are required' }
  }
  return { valid: true, parsed }
}

export function enforceVerifiedNeonConnectionString(connectionString) {
  const parsed = new URL(connectionString)
  parsed.searchParams.set('sslmode', 'verify-full')
  parsed.searchParams.set('channel_binding', 'require')
  return parsed.toString()
}

export function verifyRemoteTlsConnection(client, hostname) {
  const socket = client?.connection?.stream
  const certificate = socket?.getPeerCertificate?.()
  const identityError = certificate ? tls.checkServerIdentity(hostname, certificate) : new Error('peer certificate unavailable')
  if (socket?.encrypted !== true || socket?.authorized !== true || identityError) {
    fail('Neon TLS certificate chain or hostname verification failed')
  }
  return true
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
  const startsWithBegin = /^BEGIN\s*;$/i.test(lines[first].trim())
  const endsWithCommit = /^COMMIT\s*;$/i.test(lines[last].trim())
  if (startsWithBegin !== endsWithCommit) {
    fail('migration has an incomplete outer transaction wrapper: ' + migrationId)
  }
  if (startsWithBegin && endsWithCommit) {
    lines[first] = ''
    lines[last] = ''
  }
  return lines.join('\n').trim()
}

export function extractSqlEffects(sql) {
  const tables = new Set()
  const relation = '(?:(?:"public"|public)\\s*\\.\\s*)?"?([A-Za-z_][A-Za-z0-9_$]*)"?'
  const patterns = [
    new RegExp('\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?' + relation, 'gi'),
    new RegExp('\\bALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:IF\\s+EXISTS\\s+)?' + relation, 'gi'),
  ]
  for (const pattern of patterns) {
    for (const match of String(sql).matchAll(pattern)) tables.add(match[1])
  }
  const extensions = new Set()
  const extensionPattern = /\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/gi
  for (const match of String(sql).matchAll(extensionPattern)) extensions.add(match[1] || match[2])
  return { tables: [...tables].sort(), extensions: [...extensions].sort() }
}

export function assertManifestPrefixRows(entries, checksums, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > entries.length) {
    fail('existing ledger must contain a non-empty ordered prefix of the D1-01 manifest')
  }
  const checksumById = new Map(checksums.map((item) => [item.migrationId, item]))
  for (let i = 0; i < rows.length; i++) {
    const entry = entries[i]
    const row = rows[i]
    const checksum = checksumById.get(entry.migrationId)
    if (!entry || !checksum ||
        row.domain_id !== 'D1-01' || row.database_name !== 'luckread' ||
        row.owner_worker !== entry.ownerWorker || row.migration_id !== entry.migrationId ||
        Number(row.migration_order) !== entry.order || row.migration_kind !== entry.kind ||
        row.artifact_sha256 !== checksum.artifactSha256 ||
        row.manifest_entry_sha256 !== checksum.manifestEntrySha256 ||
        !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(row.source_commit_sha || '')) {
      fail('existing ledger row does not exactly match the ordered manifest prefix at position ' + i)
    }
  }
  return entries.slice(0, rows.length)
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
    fail('canonical manifest/checksum validation failed before execution')
  }
  try { return JSON.parse(result.stdout) } catch {
    fail('canonical checksum validator did not return JSON')
  }
}

export function isRemoteApplyReleased(manifestContract, ledgerContractValue) {
  return manifestContract?.remoteApplyReady === true &&
    ledgerContractValue?.remoteApplyReady === true &&
    manifestContract?.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    ledgerContractValue?.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED'
}

function validateManifest(checksums) {
  const releaseBlocked = manifest.remoteApplyReady === false &&
    ledgerContract.remoteApplyReady === false &&
    manifest.execution?.runnerStatus === 'NOT_IMPLEMENTED' &&
    ledgerContract.execution?.runnerStatus === 'NOT_IMPLEMENTED'
  const releaseEnabled = isRemoteApplyReleased(manifest, ledgerContract)
  if (manifest.domainId !== 'D1-01' || manifest.databaseName !== 'luckread' ||
      manifest.postgresMajor !== 18 || manifest.entries?.length !== 14 ||
      manifest.businessDataImport !== false || manifest.productionCutoverAuthorized !== false ||
      (!releaseBlocked && !releaseEnabled)) {
    fail('D1-01 manifest must remain the reviewed 14-entry schema-only contract with a consistent remote release gate')
  }
  if (!Array.isArray(checksums) || checksums.length !== manifest.entries.length) {
    fail('canonical checksums must cover every manifest entry')
  }
  const ids = new Set()
  const orders = new Set()
  let previousOrder = 0
  for (const entry of manifest.entries) {
    if (!entry.migrationId || ids.has(entry.migrationId) ||
        !Number.isSafeInteger(entry.order) || entry.order <= previousOrder || orders.has(entry.order)) {
      fail('manifest ids and order must be unique and strictly increasing')
    }
    for (const dependency of entry.dependsOn ?? []) {
      if (!ids.has(dependency)) fail('manifest dependency must appear before its dependent migration')
    }
    ids.add(entry.migrationId)
    orders.add(entry.order)
    previousOrder = entry.order
    if (entry.artifactState !== 'COMMITTED' || !Array.isArray(entry.artifactPaths) ||
        entry.artifactPaths.length === 0) {
      fail('all D1-01 artifacts must be committed before the shared runner can execute')
    }
  }
  const actualIds = new Set(checksums.map((item) => item.migrationId))
  if (actualIds.size !== ids.size || [...ids].some((id) => !actualIds.has(id))) {
    fail('checksum migration ids do not match the manifest')
  }
}

function loadSqlArtifacts(checksums) {
  const checksumById = new Map(checksums.map((item) => [item.migrationId, item]))
  const sqlById = new Map()
  for (const entry of manifest.entries) {
    if (entry.kind === 'PAYLOAD_NATIVE') continue
    if (entry.kind !== 'POSTGRESQL_SQL' && entry.kind !== 'GENERATED_POSTGRESQL_SQL') {
      fail('unsupported migration kind: ' + entry.kind)
    }
    if (entry.artifactPaths.length !== 1 || !entry.artifactPaths[0].endsWith('.sql')) {
      fail('SQL migration must have exactly one committed .sql artifact: ' + entry.migrationId)
    }
    const path = entry.artifactPaths[0]
    if (!path.startsWith('workers/') || path.split('/').includes('..')) {
      fail('artifact path escapes repository root: ' + entry.migrationId)
    }
    const sql = readFileSync(resolve(repositoryRoot, path), 'utf8')
    const effects = extractSqlEffects(sql)
    if (effects.tables.length === 0) fail('SQL migration declares no table effect: ' + entry.migrationId)
    sqlById.set(entry.migrationId, {
      path,
      body: stripOuterTransaction(sql, entry.migrationId),
      effects,
      checksum: checksumById.get(entry.migrationId),
    })
  }
  return sqlById
}

function expectedTablesForPrefix(prefixEntries, sqlById) {
  const snapshot = readJson('workers/W01-payload/src/migrations/20261101_163928_username_redirects.json')
  const tables = new Set(Object.keys(snapshot.tables))
  for (const entry of prefixEntries) {
    if (entry.kind === 'PAYLOAD_NATIVE') continue
    for (const table of sqlById.get(entry.migrationId).effects.tables) tables.add(table)
  }
  return [...tables].sort()
}

function expectedExtensionsForPrefix(prefixEntries, sqlById) {
  const extensions = new Set(['plpgsql'])
  for (const entry of prefixEntries) {
    if (entry.kind === 'PAYLOAD_NATIVE') continue
    for (const extension of sqlById.get(entry.migrationId).effects.extensions) extensions.add(extension)
  }
  return [...extensions].sort()
}

async function actualPublicTables(client) {
  const result = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE 'pg_%' ORDER BY tablename",
  )
  return result.rows.map((row) => row.tablename).filter((name) => name !== 'neon_schema_migration_ledger').sort()
}

async function verifyOwnerSchemaState(client, prefixEntries, sqlById) {
  const expected = expectedTablesForPrefix(prefixEntries, sqlById)
  const actual = await actualPublicTables(client)
  const missing = expected.filter((name) => !actual.includes(name))
  const unexpected = actual.filter((name) => !expected.includes(name))
  if (missing.length || unexpected.length) {
    fail('public table set does not match the applied manifest prefix; missing=[' +
      missing.join(',') + '] unexpected=[' + unexpected.join(',') + ']')
  }

  const schemaResult = await client.query(
    "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' ORDER BY nspname",
  )
  const schemas = schemaResult.rows.map((row) => row.nspname)
  if (JSON.stringify(schemas) !== JSON.stringify(['public'])) {
    fail('unexpected non-system schema exists: ' + schemas.join(','))
  }

  const extensionResult = await client.query(
    "SELECT extname FROM pg_catalog.pg_extension ORDER BY extname",
  )
  const actualExtensions = extensionResult.rows.map((row) => row.extname).sort()
  const expectedExtensions = expectedExtensionsForPrefix(prefixEntries, sqlById)
  if (JSON.stringify(actualExtensions) !== JSON.stringify(expectedExtensions)) {
    fail('extension set does not match the applied manifest prefix')
  }

  const businessTables = expected.filter((name) => name !== 'payload_migrations')
  const rowCounts = {}
  for (const table of businessTables) {
    const result = await client.query('SELECT COUNT(*)::bigint AS count FROM public."' +
      table.replace(/"/g, '""') + '"')
    const count = Number(result.rows[0].count)
    rowCounts[table] = count
    if (count !== 0) fail('business table is not empty: ' + table)
  }
  const payload = await client.query('SELECT name FROM public.payload_migrations ORDER BY id')
  const expectedPayloadName = '20261107_202531_neon_d1_01_payload_baseline'
  if (payload.rows.length !== 1 || payload.rows[0].name !== expectedPayloadName) {
    fail('W01 Payload migration ledger must contain exactly the committed baseline migration')
  }
  return { tableCount: expected.length, businessTableRowCounts: rowCounts }
}

async function verifyLedgerSchema(client) {
  const columns = await client.query(
    "SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='neon_schema_migration_ledger' ORDER BY column_name",
  )
  const expectedNames = [
    'applied_at','artifact_sha256','database_name','domain_id','execution_id',
    'manifest_entry_sha256','migration_id','migration_kind','migration_order',
    'owner_worker','runner_version','source_commit_sha',
  ]
  if (JSON.stringify(columns.rows.map((row) => row.column_name)) !== JSON.stringify(expectedNames)) {
    fail('shared ledger column set does not match its contract')
  }
  const columnByName = new Map(columns.rows.map((row) => [row.column_name, row]))
  for (const name of expectedNames) {
    if (columnByName.get(name)?.is_nullable !== 'NO') fail('shared ledger column must be NOT NULL: ' + name)
  }
  if (columnByName.get('migration_order')?.data_type !== 'integer' ||
      columnByName.get('applied_at')?.data_type !== 'timestamp with time zone') {
    fail('shared ledger column types do not match the contract')
  }
  const indexes = await client.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename='neon_schema_migration_ledger' ORDER BY indexname",
  )
  const expectedIndexes = [
    'neon_schema_migration_ledger_order_unique',
    'neon_schema_migration_ledger_owner_applied_idx',
    'neon_schema_migration_ledger_pkey',
  ]
  if (JSON.stringify(indexes.rows.map((row) => row.indexname)) !== JSON.stringify(expectedIndexes)) {
    fail('shared ledger index set does not match its contract')
  }
  const triggers = await client.query(
    "SELECT tgname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='neon_schema_migration_ledger' AND NOT t.tgisinternal ORDER BY tgname",
  )
  const expectedTriggers = [
    'neon_schema_migration_ledger_no_truncate',
    'neon_schema_migration_ledger_no_update_or_delete',
  ]
  if (JSON.stringify(triggers.rows.map((row) => row.tgname)) !== JSON.stringify(expectedTriggers)) {
    fail('shared ledger append-only trigger set does not match its contract')
  }
  const foreignKeys = await client.query(
    "SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_constraint WHERE conrelid='public.neon_schema_migration_ledger'::regclass AND contype='f'",
  )
  if (Number(foreignKeys.rows[0].count) !== 0) fail('shared migration ledger must not have foreign keys')
}

async function readLedgerRows(client) {
  return (await client.query(
    'SELECT domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id ' +
    'FROM public.neon_schema_migration_ledger ORDER BY migration_order',
  )).rows
}

async function insertLedgerRow(client, entry, checksum, sourceCommitSha, executionId) {
  await client.query(
    'INSERT INTO public.neon_schema_migration_ledger ' +
    '(domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    ['D1-01','luckread',entry.ownerWorker,entry.migrationId,entry.order,entry.kind,
      checksum.artifactSha256,checksum.manifestEntrySha256,sourceCommitSha,runnerVersion,executionId],
  )
}

async function run() {
  const localOnly = process.argv.includes('--local-only')
  const remoteNeon = process.argv.includes('--remote-neon')
  if (localOnly === remoteNeon) {
    fail('select exactly one execution mode: --local-only or --remote-neon')
  }

  let target
  let connectionString
  let targetDatabase
  let sourceCommitSha
  if (localOnly) {
    connectionString = process.env.D1_01_LOCAL_DATABASE_URL
    target = validateLocalTarget(connectionString)
    targetDatabase = 'luckread_schema'
    sourceCommitSha = process.env.REHEARSAL_SOURCE_COMMIT_SHA || process.env.GITHUB_SHA
  } else {
    if (process.env.GITHUB_ACTIONS !== 'true' ||
        process.env.GITHUB_REF !== 'refs/heads/main' ||
        process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
        process.env.D1_01_REMOTE_APPLY_CONFIRMATION !== 'APPLY_REVIEWED_SCHEMA_D1_01_LUCKREAD' ||
        !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') ||
        !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || '')) {
      fail('remote execution requires the protected main-only manual workflow and exact D1-01 confirmation')
    }
    if (!isRemoteApplyReleased(manifest, ledgerContract)) {
      fail('remote Neon execution remains disabled until the reviewed release gate is enabled')
    }
    connectionString = process.env.NEON_DATABASE_URL_LUCKREAD
    target = validateRemoteNeonTarget(connectionString)
    targetDatabase = 'luckread'
    sourceCommitSha = process.env.GITHUB_SHA
  }
  if (!target.valid) fail(target.reason)
  if (remoteNeon) connectionString = enforceVerifiedNeonConnectionString(connectionString)
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sourceCommitSha || '')) {
    fail('an exact source commit SHA is required for migration provenance')
  }
  const executionId = 'github-' + (process.env.GITHUB_RUN_ID || 'local') +
    '-' + (process.env.GITHUB_RUN_ATTEMPT || '1')
  const checksums = readManifestChecksums()
  validateManifest(checksums)
  const sqlById = loadSqlArtifacts(checksums)
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 1_000,
    enableChannelBinding: remoteNeon,
  })
  let lockClient
  let client
  let lockTransactionOpen = false
  try {
    lockClient = await pool.connect()
    if (remoteNeon) verifyRemoteTlsConnection(lockClient, target.parsed.hostname)
    await lockClient.query('BEGIN')
    lockTransactionOpen = true
    const identity = await lockClient.query(
      "SELECT current_database() AS database_name, current_setting('server_version_num')::integer AS version_num",
    )
    const major = Math.floor(Number(identity.rows[0]?.version_num) / 10_000)
    if (identity.rows[0]?.database_name !== targetDatabase || major !== 18) {
      fail('connected target does not match the approved D1-01 PostgreSQL 18 database identity')
    }
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('luckread:neon-schema-migration:' || current_database(), 0))",
    )

    client = await pool.connect()
    const checksumById = new Map(checksums.map((item) => [item.migrationId, item]))
    const ledgerExists = (await client.query(
      "SELECT to_regclass('public.neon_schema_migration_ledger') IS NOT NULL AS present",
    )).rows[0].present

    let appliedEntries = []
    if (ledgerExists) {
      await verifyLedgerSchema(client)
      const rows = await readLedgerRows(client)
      appliedEntries = assertManifestPrefixRows(manifest.entries, checksums, rows)
      await verifyOwnerSchemaState(client, appliedEntries, sqlById)
    } else {
      const existing = await actualPublicTables(client)
      const expectedW01 = expectedTablesForPrefix([manifest.entries[0]], sqlById)
      if (JSON.stringify(existing) !== JSON.stringify(expectedW01)) {
        fail('without a shared ledger, target must contain only the already-reconciled W01 Payload baseline')
      }
      const preflight = await verifyOwnerSchemaState(client, [manifest.entries[0]], sqlById)
      const ledgerSql = stripOuterTransaction(readFileSync(resolve(repositoryRoot, ledgerSqlPath), 'utf8'), 'shared-ledger')
      await client.query('BEGIN')
      try {
        await client.query(ledgerSql)
        await insertLedgerRow(client, manifest.entries[0], checksumById.get(manifest.entries[0].migrationId),
          sourceCommitSha, executionId)
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch {}
        throw error
      }
      appliedEntries = [manifest.entries[0]]
      await verifyLedgerSchema(client)
      if (!preflight || preflight.tableCount !== expectedW01.length) {
        fail('W01 baseline reconciliation failed before the shared ledger was installed')
      }
    }

    for (const entry of manifest.entries.slice(appliedEntries.length)) {
      if (entry.kind === 'PAYLOAD_NATIVE') fail('W01 Payload must be reconciled, never applied by the shared SQL executor')
      for (const dependency of entry.dependsOn ?? []) {
        if (!appliedEntries.some((item) => item.migrationId === dependency)) {
          fail('migration dependency has not been committed: ' + dependency)
        }
      }
      const artifact = sqlById.get(entry.migrationId)
      if (!artifact) fail('SQL artifact is missing for ' + entry.migrationId)
      await client.query('BEGIN')
      try {
        await client.query(artifact.body)
        await insertLedgerRow(client, entry, artifact.checksum, sourceCommitSha, executionId)
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch {}
        throw error
      }
      appliedEntries.push(entry)
    }

    await verifyLedgerSchema(client)
    const finalRows = await readLedgerRows(client)
    assertManifestPrefixRows(manifest.entries, checksums, finalRows)
    if (finalRows.length !== manifest.entries.length) {
      fail('shared D1-01 schema runner did not apply the full fourteen-entry manifest')
    }
    const finalSchema = await verifyOwnerSchemaState(client, appliedEntries, sqlById)
    const ledgerEvidence = {
      status: remoteNeon ? 'D1_01_SHARED_LEDGER_REMOTE_VERIFY_PASS' : 'D1_01_SHARED_LEDGER_LOCAL_VERIFY_PASS',
      domainId: 'D1-01',
      databaseName: 'luckread',
      runnerVersion,
      migrationCount: finalRows.length,
      migrations: finalRows.map((row) => ({
        ownerWorker: row.owner_worker,
        migrationId: row.migration_id,
        order: Number(row.migration_order),
        kind: row.migration_kind,
        artifactSha256: row.artifact_sha256,
        manifestEntrySha256: row.manifest_entry_sha256,
        sourceCommitSha: row.source_commit_sha,
        runnerVersion: row.runner_version,
        executionId: row.execution_id,
      })),
      sourceCommitSha,
      executionId,
      appendOnlyLedgerVerified: true,
      remoteConnectionAttempted: remoteNeon,
      remoteNeonConnected: remoteNeon,
      productionD1Touched: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
    }
    const ledgerReportPath = resolve(repositoryRoot, 'artifacts/neon/d1-01-ledger-postflight.json')
    mkdirSync(dirname(ledgerReportPath), { recursive: true })
    writeFileSync(ledgerReportPath, JSON.stringify(ledgerEvidence, null, 2) + '\n')
    process.stdout.write(JSON.stringify({
      status: remoteNeon ? 'D1_01_SHARED_REMOTE_SCHEMA_RUNNER_PASS' : 'D1_01_SHARED_LOCAL_SCHEMA_RUNNER_PASS',
      target: { database: targetDatabase, postgresMajor: major },
      migrationCount: finalRows.length,
      ownerWorkers: ['W01','W02','W07','W08'],
      tableCount: finalSchema.tableCount,
      businessTableCount: Object.keys(finalSchema.businessTableRowCounts).length,
      businessRows: finalSchema.businessTableRowCounts,
      sourceCommitSha,
      executionId,
      remoteConnectionAttempted: remoteNeon,
      remoteNeonConnected: remoteNeon,
      productionD1Touched: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
    }, null, 2) + '\n')
  } finally {
    if (client) client.release()
    if (lockTransactionOpen && lockClient) {
      try { await lockClient.query('COMMIT') } catch {}
    }
    if (lockClient) lockClient.release()
    await pool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
