import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tls from 'node:tls'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const requireFromW02 = createRequire(resolve(repositoryRoot, 'workers/W02-identity/package.json'))
const manifestPath = 'contracts/database/neon-d1-02-migration-manifest.v1.json'
const ledgerSqlPath = 'scripts/neon/d1-01/0001_schema_migration_ledger.sql'
const ledgerTable = 'neon_schema_migration_ledger'
const runnerVersion = 'd1-02-schema-runner/1.1.0'
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const fail = (message) => { throw new Error('D1-02 schema-only runner: ' + message) }
const readJson = (file) => JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8'))

export function validateLocalTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, reason: 'D1_02_LOCAL_DATABASE_URL is required' }
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return { valid: false, reason: 'database URL is invalid' }
  }
  let database
  try { database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) } catch {
    database = ''
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', 'localhost', 'postgres'].includes(parsed.hostname) ||
      parsed.port !== '5432' || database !== 'luckread_d1_02_schema') {
    return { valid: false, reason: 'runner is local-only and accepts only PostgreSQL luckread_d1_02_schema on port 5432' }
  }
  if (!parsed.username || !parsed.password) {
    return { valid: false, reason: 'local PostgreSQL credentials are required' }
  }
  return { valid: true, parsed }
}

const approvedNeonHost = 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech'
const remoteConfirmation = 'APPLY_REVIEWED_SCHEMA_D1_02_LUCKREADPRO'

export function validateRemoteNeonTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, reason: 'NEON_DATABASE_URL_LUCKREADPRO is required' }
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return { valid: false, reason: 'Neon database URL is invalid' }
  }
  let database
  try { database = decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) } catch { database = '' }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.hostname.toLowerCase() !== approvedNeonHost ||
      !['', '5432'].includes(parsed.port) || database !== 'luckreadpro') {
    return { valid: false, reason: 'remote runner accepts only the pinned D1-02 luckreadpro Neon endpoint and database' }
  }
  if (parsed.searchParams.getAll('sslmode').length !== 1 ||
      !['require', 'verify-full'].includes(parsed.searchParams.get('sslmode')) ||
      parsed.searchParams.getAll('channel_binding').length !== 1 ||
      parsed.searchParams.get('channel_binding') !== 'require') {
    return { valid: false, reason: 'Neon connection must use sslmode=require or verify-full with channel_binding=require' }
  }
  if (!parsed.username || !parsed.password) return { valid: false, reason: 'Neon database credentials are required' }
  return { valid: true, parsed }
}

export function enforceVerifiedNeonConnectionString(connectionString) {
  const parsed = new URL(connectionString)
  parsed.searchParams.set('sslmode', 'verify-full')
  parsed.searchParams.set('channel_binding', 'require')
  return parsed.toString()
}

export function validateRemoteApplyContext({ githubActions, githubRef, confirmation } = {}) {
  const errors = []
  if (githubActions !== 'true') errors.push('remote apply is permitted only inside GitHub Actions')
  if (githubRef !== 'refs/heads/main') errors.push('remote apply is permitted only from the main branch')
  if (confirmation !== remoteConfirmation) errors.push('exact D1-02 remote apply confirmation is required')
  return { valid: errors.length === 0, errors }
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
  const begins = /^BEGIN\s*;$/i.test(lines[first].trim())
  const commits = /^COMMIT\s*;$/i.test(lines[last].trim())
  if (begins !== commits) fail('migration has an incomplete outer transaction wrapper: ' + migrationId)
  if (begins && commits) {
    lines[first] = ''
    lines[last] = ''
  }
  return lines.join('\n').trim()
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

export function validateManifestShape(manifest) {
  const errors = []
  const target = manifest?.target ?? manifest
  if (manifest?.domainId !== 'D1-02' ||
      manifest?.databaseName !== 'luckreadpro' ||
      manifest?.databaseUuid !== '6c342634-97f6-4248-9f4a-85772af4f22c' ||
      manifest?.postgresMajor !== 18 ||
      manifest?.businessDataImport !== false ||
      manifest?.productionCutoverAuthorized !== false ||
      typeof manifest?.remoteApplyReady !== 'boolean' ||
      manifest?.ledger?.table !== ledgerTable ||
      manifest?.ledger?.domainId !== 'D1-02' ||
      manifest?.ledger?.databaseName !== 'luckreadpro' ||
      manifest?.ledger?.ddlPath !== ledgerSqlPath) {
    errors.push('manifest must pin the exact D1-02 luckreadpro PostgreSQL 18 schema-only target')
  }
  const entries = manifest?.entries
  const expected = [
    {
      migrationId: 'd1-02-w03-content-schema-v1',
      order: 1,
      ownerWorker: 'W03',
      kind: 'GENERATED_POSTGRESQL_SQL',
      artifactPaths: ['workers/W03-content/src/neon-postgres-migrations/0001_w03_d1_02_content_schema.sql'],
      dependsOn: [],
    },
    {
      migrationId: 'd1-02-w05-social-schema-v1',
      order: 2,
      ownerWorker: 'W05',
      kind: 'GENERATED_POSTGRESQL_SQL',
      artifactPaths: ['workers/W05-social/src/neon-postgres-migrations/0001_w05_d1_02_social_schema.sql'],
      dependsOn: ['d1-02-w03-content-schema-v1'],
    },
    {
      migrationId: 'd1-02-w03-content-snowflake-timestamp-bigint-v1',
      order: 3,
      ownerWorker: 'W03',
      kind: 'POSTGRESQL_SQL',
      artifactPaths: ['workers/W03-content/src/neon-postgres-migrations/0002_w03_d1_02_content_snowflake_timestamp_bigint.sql'],
      dependsOn: ['d1-02-w03-content-schema-v1', 'd1-02-w05-social-schema-v1'],
      expectedTableCount: 0,
    },
  ]
  if (!Array.isArray(entries) || canonicalJson(entries) !== canonicalJson(expected)) {
    errors.push('manifest entries must contain only W03 first and W05 second with exact committed PostgreSQL artifacts')
  }
  if (manifest?.expected?.tables !== 28 ||
      manifest?.expected?.explicitIndexes !== 63 ||
      manifest?.expected?.triggers !== 9 ||
      manifest?.expected?.triggerFunctions !== 10 ||
      manifest?.expected?.businessRows !== 0 ||
      manifest?.expected?.snowflakeAllocatorRows !== 1 ||
      manifest?.expected?.foreignKeys !== 0 ||
      manifest?.expected?.d1_03EndpointTable !== false ||
      manifest?.expected?.migrationLedgerRows !== 3) {
    errors.push('manifest object inventory or empty-data invariants do not match the approved D1-02 contract')
  }
  if (errors.length) return { valid: false, errors }
  return { valid: true, target, entries }
}

export function buildArtifactChecksums(manifest, readArtifact) {
  const shape = validateManifestShape(manifest)
  if (!shape.valid) fail(shape.errors.join('; '))
  return shape.entries.map((entry) => {
    const paths = [...entry.artifactPaths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    const bundle = createHash('sha256')
    const tableNames = []
    for (const relativePath of paths) {
      if (relativePath.startsWith('/') || relativePath.split(/[\\/]/).includes('..')) {
        fail('unsafe artifact path: ' + relativePath)
      }
      const content = readArtifact(relativePath)
      if (!Buffer.isBuffer(content)) fail('artifact loader must return a Buffer for exact byte checksums')
      const pathBytes = Buffer.from(relativePath, 'utf8')
      const pathLength = Buffer.alloc(4)
      pathLength.writeUInt32BE(pathBytes.length)
      const contentLength = Buffer.alloc(8)
      contentLength.writeBigUInt64BE(BigInt(content.length))
      bundle.update(pathLength).update(pathBytes).update(contentLength).update(content)
      const sql = content.toString('utf8')
      if (!sql.trim()) fail('artifact is empty: ' + relativePath)
      tableNames.push(...[...sql.matchAll(/^CREATE TABLE ([a-z_][a-z0-9_]*)/gim)].map((match) => match[1]))
      if (!/^-- GENERATED FILE\./m.test(sql) ||
          !/^BEGIN;\s*$/m.test(sql) || !/^COMMIT;\s*$/m.test(sql)) {
        fail('artifact must be a committed PostgreSQL-native generated SQL file: ' + relativePath)
      }
      const uncommented = sql.replace(/^--.*$/gm, '')
      if (/\bFOREIGN\s+KEY\b|\bREFERENCES\s+[a-z_]/i.test(uncommented)) {
        fail('cross-domain or owner foreign keys are forbidden: ' + relativePath)
      }
      if (/\b(?:PRAGMA|AUTOINCREMENT|strftime|julianday|GLOB|json_valid|json_extract|json_object|randomblob)\b|\bINSERT\s+OR\s+IGNORE\b/i.test(uncommented)) {
        fail('SQLite-only syntax is forbidden in PostgreSQL artifacts: ' + relativePath)
      }
      if (/notification_push_endpoints|bda1d247-a371-4244-91ae-aef96034db7f/i.test(uncommented)) {
        fail('W05 D1-03/W09 endpoint schema must remain excluded: ' + relativePath)
      }
    }
    if (new Set(tableNames).size !== tableNames.length) {
      fail('artifact bundle contains duplicate table declarations for ' + entry.migrationId)
    }
    const expectedTableCount = Number.isInteger(entry.expectedTableCount)
      ? entry.expectedTableCount
      : (entry.ownerWorker === 'W03' ? 9 : 19)
    if (tableNames.length !== expectedTableCount) {
      fail(entry.ownerWorker + ' table count does not match the migration entry contract: ' + entry.migrationId)
    }
    const manifestEntrySha256 = createHash('sha256')
      .update(canonicalJson(entry), 'utf8').digest('hex')
    return {
      migrationId: entry.migrationId,
      ownerWorker: entry.ownerWorker,
      order: entry.order,
      kind: entry.kind,
      artifactSha256: bundle.digest('hex'),
      manifestEntrySha256,
      artifactPaths: [...entry.artifactPaths],
      tableNames: tableNames.sort(),
    }
  })
}

function actualPublicTables(client) {
  return client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'pg_%' ORDER BY tablename",
  ).then((result) => result.rows.map((row) => row.tablename))
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
    fail('shared append-only migration ledger column set does not match the contract')
  }
  if (columns.rows.some((row) => row.is_nullable !== 'NO')) {
    fail('shared migration ledger columns must all be NOT NULL')
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
    fail('shared append-only migration ledger index set does not match the contract')
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
    fail('shared append-only migration ledger trigger set does not match the contract')
  }
  const foreignKeys = await client.query(
    "SELECT count(*)::integer AS count FROM pg_catalog.pg_constraint WHERE conrelid=$1::regclass AND contype='f'",
    ['public.' + ledgerTable],
  )
  if (Number(foreignKeys.rows[0].count) !== 0) fail('shared migration ledger must not have foreign keys')
}

async function ensureLedger(client) {
  const present = (await client.query("SELECT to_regclass('public.neon_schema_migration_ledger') IS NOT NULL AS present")).rows[0].present
  if (!present) {
    const existingTables = await actualPublicTables(client)
    const existingObjects = await client.query(
      "SELECT count(*)::integer AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%'",
    )
    if (existingTables.length !== 0 || Number(existingObjects.rows[0].count) !== 0) {
      fail('first apply requires an empty public schema; existing public objects were found')
    }
    const ledgerSql = stripOuterTransaction(
      readFileSync(resolve(repositoryRoot, ledgerSqlPath), 'utf8'),
      'shared-ledger',
    )
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

async function readD1_02LedgerRows(client) {
  const allRows = await client.query(
    'SELECT domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,artifact_sha256,manifest_entry_sha256,source_commit_sha ' +
    'FROM public.neon_schema_migration_ledger ORDER BY domain_id,migration_order',
  )
  if (allRows.rows.some((row) => row.domain_id !== 'D1-02' || row.database_name !== 'luckreadpro')) {
    fail('D1-02 Neon database contains ledger rows for another logical domain or database')
  }
  return allRows.rows
}

function assertLedgerPrefix(entries, checksums, rows) {
  if (!Array.isArray(rows) || rows.length > entries.length) {
    fail('D1-02 ledger must contain only an ordered prefix of the current immutable manifest')
  }
  for (let i = 0; i < rows.length; i++) {
    const expected = entries[i]
    const checksum = checksums[i]
    const row = rows[i]
    if (row.domain_id !== 'D1-02' || row.database_name !== 'luckreadpro' ||
        row.owner_worker !== expected.ownerWorker ||
        row.migration_id !== expected.migrationId ||
        Number(row.migration_order) !== expected.order ||
        row.migration_kind !== expected.kind ||
        row.artifact_sha256 !== checksum.artifactSha256 ||
        row.manifest_entry_sha256 !== checksum.manifestEntrySha256 ||
        !SHA.test(row.source_commit_sha || '')) {
      fail('existing D1-02 ledger row does not exactly match the immutable manifest prefix at position ' + i)
    }
  }
  return entries.slice(0, rows.length)
}

async function verifyOwnerTableState(client, appliedEntries, checksums) {
  const expected = [ledgerTable, ...appliedEntries.flatMap((entry, index) => checksums[index].tableNames)].sort()
  const actual = await actualPublicTables(client)
  const missing = expected.filter((name) => !actual.includes(name))
  const unexpected = actual.filter((name) => !expected.includes(name))
  if (missing.length || unexpected.length) {
    fail('public table set differs from the exact applied D1-02 migration prefix; missing=[' +
      missing.join(',') + '] unexpected=[' + unexpected.join(',') + ']')
  }
  const businessTables = expected.filter((name) => name !== ledgerTable && name !== 'content_id_snowflake_state')
  for (const table of businessTables) {
    const result = await client.query('SELECT count(*)::bigint AS count FROM public."' +
      table.replace(/"/g, '""') + '"')
    if (Number(result.rows[0].count) !== 0) fail('business table must remain empty: ' + table)
  }
  if (appliedEntries.some((entry) => entry.ownerWorker === 'W03')) {
    const allocator = await client.query(
      'SELECT id,last_timestamp_ms,sequence FROM public.content_id_snowflake_state ORDER BY id',
    )
    if (allocator.rows.length !== 1 || Number(allocator.rows[0].id) !== 1 ||
        Number(allocator.rows[0].last_timestamp_ms) !== -1 ||
        Number(allocator.rows[0].sequence) !== 4095) {
      fail('only the required W03 Snowflake allocator singleton may be seeded')
    }
  }
  if (appliedEntries.some((entry) => entry.migrationId === 'd1-02-w03-content-snowflake-timestamp-bigint-v1')) {
    const timestampColumn = await client.query(
      "SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='content_id_snowflake_state' AND column_name='last_timestamp_ms'",
    )
    if (timestampColumn.rows.length !== 1 || timestampColumn.rows[0].data_type !== 'bigint') {
      fail('W03 Snowflake last_timestamp_ms must be PostgreSQL BIGINT for Unix millisecond values')
    }
  }
  return { tableCount: expected.length - 1, businessTableCount: businessTables.length }
}

async function insertLedgerRow(client, entry, checksum, sourceCommitSha, executionId) {
  await client.query(
    'INSERT INTO public.neon_schema_migration_ledger ' +
    '(domain_id,database_name,owner_worker,migration_id,migration_order,migration_kind,artifact_sha256,manifest_entry_sha256,source_commit_sha,runner_version,execution_id) ' +
    'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    ['D1-02','luckreadpro',entry.ownerWorker,entry.migrationId,entry.order,entry.kind,
      checksum.artifactSha256,checksum.manifestEntrySha256,sourceCommitSha,runnerVersion,executionId],
  )
}

async function run() {
  if (process.argv.length !== 3 || !['--local-only', '--remote-neon'].includes(process.argv[2])) {
    fail('select exactly one execution mode: --local-only or --remote-neon')
  }
  const remoteNeon = process.argv[2] === '--remote-neon'
  let connectionString
  let target
  let sourceCommitSha
  if (remoteNeon) {
    const context = validateRemoteApplyContext({
      githubActions: process.env.GITHUB_ACTIONS,
      githubRef: process.env.GITHUB_REF,
      confirmation: process.env.D1_02_REMOTE_APPLY_CONFIRMATION,
    })
    if (!context.valid) fail(context.errors.join('; '))
    connectionString = process.env.NEON_DATABASE_URL_LUCKREADPRO_VERIFIED || process.env.NEON_DATABASE_URL_LUCKREADPRO
    target = validateRemoteNeonTarget(connectionString)
    if (!target.valid) fail(target.reason)
    connectionString = enforceVerifiedNeonConnectionString(connectionString)
    sourceCommitSha = process.env.GITHUB_SHA
  } else {
    connectionString = process.env.D1_02_LOCAL_DATABASE_URL
    target = validateLocalTarget(connectionString)
    if (!target.valid) fail(target.reason)
    sourceCommitSha = process.env.REHEARSAL_SOURCE_COMMIT_SHA || process.env.GITHUB_SHA
  }
  if (!SHA.test(sourceCommitSha || '')) fail('an exact source commit SHA is required for migration provenance')
  const executionId = (remoteNeon ? 'github-' : 'local-') + (process.env.GITHUB_RUN_ID || process.pid) +
    '-' + (process.env.GITHUB_RUN_ATTEMPT || '1')
  const manifest = readJson(manifestPath)
  const shape = validateManifestShape(manifest)
  if (remoteNeon && manifest.remoteApplyReady !== true) {
    fail('D1-02 remote apply is intentionally blocked until its separate reviewed release contract is enabled')
  }
  if (!shape.valid) fail(shape.errors.join('; '))
  const checksums = buildArtifactChecksums(manifest, (file) =>
    readFileSync(resolve(repositoryRoot, file)),
  )
  const artifacts = new Map(manifest.entries.map((entry, index) => [
    entry.migrationId,
    stripOuterTransaction(
      readFileSync(resolve(repositoryRoot, entry.artifactPaths[0]), 'utf8'),
      entry.migrationId,
    ),
  ]))
  const { Pool } = requireFromW02('pg')
  const pool = new Pool({
    connectionString,
    max: 2,
    ...(remoteNeon ? { ssl: { rejectUnauthorized: true } } : {}),
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 1_000,
  })
  let lockClient
  let client
  let lockOpen = false
  try {
    lockClient = await pool.connect()
    await lockClient.query('BEGIN')
    lockOpen = true
    if (remoteNeon) verifyRemoteTlsConnection(lockClient, target.parsed.hostname)
    const identity = await lockClient.query(
      "SELECT current_database() AS database_name,current_setting('server_version_num')::integer AS version_num",
    )
    const major = Math.floor(Number(identity.rows[0]?.version_num) / 10_000)
    const expectedDatabase = remoteNeon ? 'luckreadpro' : 'luckread_d1_02_schema'
    if (identity.rows[0]?.database_name !== expectedDatabase || major !== 18) {
      fail('connected database must be the exact approved D1-02 PostgreSQL 18 target')
    }
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('luckread:neon-schema-migration:' || current_database(),0))",
    )

    client = await pool.connect()
    if (remoteNeon) verifyRemoteTlsConnection(client, target.parsed.hostname)
    await ensureLedger(client)
    let appliedEntries = assertLedgerPrefix(shape.entries, checksums, await readD1_02LedgerRows(client))
    await verifyOwnerTableState(client, appliedEntries, checksums)

    for (const entry of shape.entries.slice(appliedEntries.length)) {
      for (const dependency of entry.dependsOn ?? []) {
        if (!appliedEntries.some((item) => item.migrationId === dependency)) {
          fail('migration dependency has not been committed: ' + dependency)
        }
      }
      const checksum = checksums.find((item) => item.migrationId === entry.migrationId)
      await client.query('BEGIN')
      try {
        await client.query(artifacts.get(entry.migrationId))
        await insertLedgerRow(client, entry, checksum, sourceCommitSha, executionId)
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch {}
        throw error
      }
      appliedEntries = [...appliedEntries, entry]
      await assertLedgerPrefix(shape.entries, checksums, await readD1_02LedgerRows(client))
      await verifyOwnerTableState(client, appliedEntries, checksums)
    }

    const rows = await readD1_02LedgerRows(client)
    assertLedgerPrefix(shape.entries, checksums, rows)
    if (rows.length !== shape.entries.length) fail('D1-02 runner did not complete every manifest migration')
    const schemaState = await verifyOwnerTableState(client, appliedEntries, checksums)
    const report = {
      reportType: remoteNeon ? 'NEON_D1_02_SCHEMA_ONLY_RUNNER_REMOTE_POSTFLIGHT' : 'NEON_D1_02_SCHEMA_ONLY_RUNNER_LOCAL_POSTFLIGHT',
      status: remoteNeon ? 'D1_02_REMOTE_SCHEMA_ONLY_APPLY_PASS' : 'D1_02_LOCAL_SCHEMA_ONLY_APPLY_PASS',
      domainId: 'D1-02',
      databaseName: 'luckreadpro',
      databaseUuid: manifest.databaseUuid,
      postgresMajor: 18,
      appliedMigrations: rows.map((row) => ({
        ownerWorker: row.owner_worker,
        migrationId: row.migration_id,
        migrationOrder: Number(row.migration_order),
        artifactSha256: row.artifact_sha256,
        manifestEntrySha256: row.manifest_entry_sha256,
        sourceCommitSha: row.source_commit_sha,
      })),
      schemaState,
      safety: {
        remoteNeonTouched: remoteNeon,
        cloudflareD1Touched: false,
        businessDataImported: false,
        productionCutoverAuthorized: false,
        d1_03EndpointSchemaIncluded: false,
      },
    }
    const output = process.env.D1_02_SCHEMA_APPLY_REPORT || 'artifacts/neon/d1-02-schema-runner-postflight.json'
    mkdirSync(dirname(resolve(repositoryRoot, output)), { recursive: true })
    writeFileSync(resolve(repositoryRoot, output), JSON.stringify(report, null, 2) + '\n')
    console.log((remoteNeon ? 'NEON_D1_02_REMOTE_SCHEMA_ONLY_RUNNER_PASS ' : 'NEON_D1_02_LOCAL_SCHEMA_ONLY_RUNNER_PASS ') + JSON.stringify({
      databaseName: report.databaseName,
      postgresMajor: report.postgresMajor,
      appliedMigrations: rows.length,
      tableCount: schemaState.tableCount,
      businessTableCount: schemaState.businessTableCount,
      remoteNeonTouched: remoteNeon,
      cloudflareD1Touched: false,
      businessDataImported: false,
    }))
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
