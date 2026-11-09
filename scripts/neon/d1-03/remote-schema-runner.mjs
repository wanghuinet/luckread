import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import tls from 'node:tls'
import {
  DOMAIN_MANIFESTS,
  buildDomainPlan,
  assertLedgerPrefixRows,
  stripOuterTransaction,
  validateLocalTarget,
} from '../shared-domain-schema-runner.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const requireFromW02 = createRequire(resolve(root, 'workers/W02-identity/package.json'))
const ledgerSqlPath = 'scripts/neon/d1-01/0001_schema_migration_ledger.sql'
const ledgerTable = 'neon_schema_migration_ledger'
const ledgerFunction = 'neon_schema_migration_ledger_reject_mutation'
const runnerVersion = 'd1-03-partial-remote-runner/1.0.0'
const databaseName = 'luckread_governance'
const approvedHost = 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech'
const confirmation = 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE_PARTIAL'
const SHA40 = /^[0-9a-f]{40}$/
const fail = (message) => { throw new Error('D1-03 partial remote runner: ' + message) }
const readText = (path) => readFileSync(resolve(root, path), 'utf8')
const readJson = (path) => JSON.parse(readText(path))

function isSafeRepositoryPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 ||
      relativePath.startsWith('/') || relativePath.includes('\\') ||
      relativePath.split('/').includes('..')) return false
  return resolve(root, relativePath).startsWith(root + sep)
}

export function validateD103RemoteNeonTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, reason: 'NEON_DATABASE_URL_GOVERNANCE_VERIFIED is required' }
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return { valid: false, reason: 'D1-03 Neon database URL is invalid' }
  }
  const database = (() => {
    const databasePath = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname
    try { return decodeURIComponent(databasePath) } catch { return '' }
  })()
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.hostname.toLowerCase() !== approvedHost ||
      !['', '5432'].includes(parsed.port) ||
      database !== databaseName) {
    return { valid: false, reason: 'remote runner accepts only the pinned D1-03 Neon endpoint and luckread_governance database' }
  }
  if (parsed.searchParams.getAll('sslmode').length !== 1 ||
      parsed.searchParams.get('sslmode') !== 'verify-full' ||
      parsed.searchParams.getAll('channel_binding').length !== 1 ||
      parsed.searchParams.get('channel_binding') !== 'require') {
    return { valid: false, reason: 'D1-03 Neon connection must use sslmode=verify-full and channel_binding=require' }
  }
  if (!parsed.username || !parsed.password) {
    return { valid: false, reason: 'D1-03 Neon database credentials are required' }
  }
  return { valid: true, parsed }
}

export function enforceD103VerifiedNeonConnectionString(connectionString) {
  const parsed = new URL(connectionString)
  parsed.searchParams.set('sslmode', 'verify-full')
  parsed.searchParams.set('channel_binding', 'require')
  return parsed.toString()
}

export function validateD103RemoteApplyContext({ githubActions, githubRef, confirmation: suppliedConfirmation } = {}) {
  const errors = []
  if (githubActions !== 'true') errors.push('remote apply is permitted only inside GitHub Actions')
  if (githubRef !== 'refs/heads/main') errors.push('remote apply is permitted only from the main branch')
  if (suppliedConfirmation !== confirmation) errors.push('exact D1-03 partial schema confirmation is required')
  return { valid: errors.length === 0, errors }
}

export function verifyD103RemoteTlsConnection(client, hostname = approvedHost) {
  const socket = client?.connection?.stream
  const certificate = socket?.getPeerCertificate?.()
  const identityError = certificate
    ? tls.checkServerIdentity(hostname, certificate)
    : new Error('peer certificate unavailable')
  if (socket?.encrypted !== true || socket?.authorized !== true || identityError) {
    fail('Neon TLS certificate chain or hostname verification failed')
  }
  return true
}

async function verifyPublicSchema(client) {
  const schemas = await client.query(
    "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' ORDER BY nspname",
  )
  if (JSON.stringify(schemas.rows.map((row) => row.nspname)) !== JSON.stringify(['public'])) {
    fail('unexpected non-system schema exists')
  }
  const extensions = await client.query('SELECT extname FROM pg_catalog.pg_extension ORDER BY extname')
  if (JSON.stringify(extensions.rows.map((row) => row.extname)) !== JSON.stringify(['plpgsql'])) {
    fail('PostgreSQL extension set must remain exactly plpgsql')
  }
}

async function verifyEmptyBootstrapTarget(client) {
  await verifyPublicSchema(client)
  const relations = await client.query(
    "SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%' ORDER BY c.relname",
  )
  if (relations.rows.length !== 0) fail('first D1-03 apply requires an empty public schema')
  const types = await client.query(
    "SELECT t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('c','d','e','r','m') ORDER BY t.typname",
  )
  if (types.rows.length !== 0) fail('first D1-03 apply requires no pre-existing public custom types')
  const routines = await client.query(
    "SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname",
  )
  if (routines.rows.length !== 0) fail('first D1-03 apply requires no pre-existing public routines')
  const globalObjects = await client.query(
    "SELECT evtname AS object_name,'event_trigger' AS object_kind FROM pg_catalog.pg_event_trigger " +
    "UNION ALL SELECT pubname,'publication' FROM pg_catalog.pg_publication " +
    "UNION ALL SELECT fdwname,'foreign_data_wrapper' FROM pg_catalog.pg_foreign_data_wrapper " +
    "UNION ALL SELECT srvname,'foreign_server' FROM pg_catalog.pg_foreign_server",
  )
  if (globalObjects.rows.length !== 0) fail('unexpected database-global PostgreSQL objects block D1-03 bootstrap')
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
    fail('shared append-only migration ledger columns do not match the contract')
  }
  if (columns.rows.some((row) => row.is_nullable !== 'NO')) {
    fail('shared migration ledger columns must all be NOT NULL')
  }
  const types = new Map(columns.rows.map((row) => [row.column_name,row.data_type]))
  if (types.get('migration_order') !== 'integer' || types.get('applied_at') !== 'timestamp with time zone') {
    fail('shared migration ledger column types do not match the contract')
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
    fail('shared migration ledger index set does not match the contract')
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
    fail('shared ledger append-only trigger set does not match the contract')
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
    await verifyEmptyBootstrapTarget(client)
    const sql = stripOuterTransaction(readText(ledgerSqlPath), 'shared-ledger')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('COMMIT')
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    }
  }
  await verifyPublicSchema(client)
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

async function verifyOwnerSchemaState(client, plan, appliedCount) {
  const applied = plan.entries.slice(0,appliedCount)
  const expectedTables = applied.flatMap((item) => item.effects.tables).sort()
  const expectedRelations = [...expectedTables,ledgerTable].sort()
  const relationRows = await client.query(
    "SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%' ORDER BY c.relname",
  )
  const actualRelations = relationRows.rows.map((row) => row.relname)
  if (JSON.stringify(actualRelations) !== JSON.stringify(expectedRelations)) {
    fail('public relation set differs from the applied D1-03 manifest prefix; actual=[' +
      actualRelations.join(',') + '] expected=[' + expectedRelations.join(',') + ']')
  }
  await verifyPublicSchema(client)
  const rowCounts = {}
  for (const table of expectedTables) {
    const result = await client.query('SELECT COUNT(*)::bigint AS count FROM public."' +
      table.replace(/"/g,'""') + '"')
    const count = Number(result.rows[0].count)
    rowCounts[table] = count
    if (count !== 0) fail('D1-03 business table must remain empty: ' + table)
  }
  return { tableCount: expectedTables.length, tableRowCounts: rowCounts, controlSeedRows: 0, businessRows: 0 }
}

async function verifyFinalCatalog(client, manifest, plan) {
  const indexRows = await client.query(
    "SELECT index_class.relname AS indexname, " +
    "EXISTS (SELECT 1 FROM pg_catalog.pg_constraint constraint_row " +
    "WHERE constraint_row.conindid = index_class.oid AND constraint_row.contype IN ('p','u')) AS constraint_backed " +
    "FROM pg_catalog.pg_index index_row " +
    "JOIN pg_catalog.pg_class index_class ON index_class.oid=index_row.indexrelid " +
    "JOIN pg_catalog.pg_class table_class ON table_class.oid=index_row.indrelid " +
    "JOIN pg_catalog.pg_namespace namespace ON namespace.oid=table_class.relnamespace " +
    "WHERE namespace.nspname='public' AND table_class.relname <> $1 ORDER BY index_class.relname",
    [ledgerTable],
  )
  const actualExplicitIndexes = indexRows.rows.filter((row) => row.constraint_backed !== true)
    .map((row) => row.indexname).sort()
  const expectedExplicitIndexes = [...plan.indexes].sort()
  if (JSON.stringify(actualExplicitIndexes) !== JSON.stringify(expectedExplicitIndexes)) {
    fail('actual D1-03 explicit index set differs from the admitted manifest; actual=[' +
      actualExplicitIndexes.join(',') + '] expected=[' + expectedExplicitIndexes.join(',') + ']')
  }
  const constraintIndexCount = indexRows.rows.filter((row) => row.constraint_backed === true).length

  const triggerRows = await client.query(
    "SELECT t.tgname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname <> $1 AND NOT t.tgisinternal ORDER BY t.tgname",
    [ledgerTable],
  )
  const actualTriggers = triggerRows.rows.map((row) => row.tgname)
  if (JSON.stringify(actualTriggers) !== JSON.stringify(plan.triggers)) {
    fail('actual D1-03 trigger set differs from the admitted migration plan')
  }

  const functionRows = await client.query(
    "SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname <> $1 ORDER BY p.proname",
    [ledgerFunction],
  )
  const actualFunctions = functionRows.rows.map((row) => row.proname)
  if (JSON.stringify(actualFunctions) !== JSON.stringify(plan.functions)) {
    fail('actual D1-03 function set differs from the admitted migration plan')
  }

  const foreignKeys = await client.query(
    "SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_constraint constraint_row " +
    "JOIN pg_catalog.pg_namespace namespace ON namespace.oid=constraint_row.connamespace " +
    "WHERE namespace.nspname='public' AND constraint_row.contype='f' AND constraint_row.conrelid <> $1::regclass",
    ['public.' + ledgerTable],
  )
  if (Number(foreignKeys.rows[0].count) !== manifest.expected.foreignKeys) {
    fail('actual D1-03 foreign-key count differs from the admitted manifest')
  }
  if (plan.indexes.length !== manifest.expected.explicitIndexes ||
      plan.triggers.length !== manifest.expected.triggers ||
      plan.functions.length !== manifest.expected.triggerFunctions) {
    fail('D1-03 manifest object totals do not match the reviewed catalog contract')
  }
  const tableRows = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> $1 ORDER BY tablename",
    [ledgerTable],
  )
  if (tableRows.rows.length !== manifest.expected.tables) {
    fail('actual D1-03 table count differs from the admitted manifest')
  }
  return {
    tables: tableRows.rows.length,
    explicitIndexes: actualExplicitIndexes.length,
    constraintIndexes: constraintIndexCount,
    triggers: actualTriggers.length,
    triggerFunctions: actualFunctions.length,
    foreignKeys: Number(foreignKeys.rows[0].count),
    controlSeedRows: 0,
    businessRows: 0,
  }
}

export function parseCommandLine(argv) {
  if (argv.length !== 1) return { valid: false, reason: 'select exactly one execution mode: --local-only or --remote-neon' }
  if (argv[0] === '--local-only') return { valid: true, mode: 'LOCAL_ONLY' }
  if (argv[0] === '--remote-neon') return { valid: true, mode: 'REMOTE_NEON' }
  return { valid: false, reason: 'select exactly one execution mode: --local-only or --remote-neon' }
}

async function runD103Domain({ env = process.env, mode = 'remote' } = {}) {
  const remote = mode === 'remote'
  if (!remote && mode !== 'local') fail('unsupported D1-03 execution mode')
  if (remote) {
    const context = validateD103RemoteApplyContext({
      githubActions: env.GITHUB_ACTIONS,
      githubRef: env.GITHUB_REF,
      confirmation: env.D1_03_REMOTE_APPLY_CONFIRMATION,
    })
    if (!context.valid) fail(context.errors.join('; '))
  }

  const manifest = readJson(DOMAIN_MANIFESTS['D1-03'])
  const plan = buildDomainPlan(manifest)
  if (manifest.domainId !== 'D1-03' ||
      manifest.databaseName !== databaseName ||
      manifest.cloudflareD1DatabaseUuid !== 'bda1d247-a371-4244-91ae-aef96034db7f' ||
      manifest.postgresMajor !== 18 ||
      manifest.remoteApplyReady !== false ||
      manifest.businessDataImport !== false ||
      manifest.productionCutoverAuthorized !== false ||
      manifest.entries.length !== 3 ||
      manifest.expected?.tables !== 15 ||
      manifest.expected?.explicitIndexes !== 22 ||
      manifest.expected?.triggers !== 2 ||
      manifest.expected?.triggerFunctions !== 1 ||
      manifest.expected?.foreignKeys !== 2 ||
      manifest.expected?.businessRows !== 0 ||
      manifest.expected?.controlSeedRows !== 0) {
    fail('manifest must remain exactly the three admitted W06/W09/W10 schema entries and their 15-table object inventory')
  }

  let connectionString
  let target
  let sourceCommitSha
  let executionId
  let output
  const reportMode = remote ? 'REMOTE_PARTIAL_SCHEMA' : 'LOCAL_PARTIAL_SCHEMA_REHEARSAL'
  if (remote) {
    const release = readJson('contracts/database/neon-d1-03-remote-runner-review.v1.json')
    if (release?.status !== 'PARTIAL_SCHEMA_REMOTE_RELEASE_APPROVED' ||
        release?.partialRemoteApplyReady !== true ||
        release?.remoteApplyReady !== false ||
        release?.target?.domainId !== 'D1-03' ||
        release?.target?.databaseName !== databaseName ||
        release?.target?.neonHost !== approvedHost ||
        release?.scope?.kind !== 'ADMITTED_MANIFEST_ENTRIES_ONLY' ||
        release?.scope?.migrationCount !== 3 ||
        release?.scope?.tables !== 15 ||
        release?.scope?.fullDomainSchemaComplete !== false ||
        release?.businessDataImport !== false ||
        release?.productionCutoverAuthorized !== false) {
      fail('D1-03 partial remote release record is absent, stale or outside the exact admitted schema scope')
    }
    connectionString = env.NEON_DATABASE_URL_GOVERNANCE_VERIFIED
    target = validateD103RemoteNeonTarget(connectionString)
    if (!target.valid) fail(target.reason)
    sourceCommitSha = env.GITHUB_SHA
    executionId = 'github-' + (env.GITHUB_RUN_ID || 'manual') + '-' +
      (env.GITHUB_RUN_ATTEMPT || '1') + '-' + process.pid
    output = env.D1_03_SCHEMA_APPLY_REPORT || 'artifacts/neon/d1-03-schema-runner-remote-postflight.json'
  } else {
    connectionString = env.D1_SHARED_LOCAL_DATABASE_URL
    target = validateLocalTarget(connectionString,manifest)
    if (!target.valid) fail(target.reason)
    sourceCommitSha = env.GITHUB_SHA || env.REHEARSAL_SOURCE_COMMIT_SHA
    executionId = 'local-' + (env.GITHUB_RUN_ID || 'manual') + '-' +
      (env.GITHUB_RUN_ATTEMPT || '1') + '-' + process.pid
    output = env.D1_03_LOCAL_SCHEMA_APPLY_REPORT ||
      'artifacts/neon/d1-03-remote-runner-local-postflight.json'
  }
  if (!SHA40.test(sourceCommitSha || '')) fail('exact source commit SHA is required for migration provenance')
  if (!isSafeRepositoryPath(output)) fail('postflight report path must remain inside the repository')

  const { Pool } = requireFromW02('pg')
  const poolOptions = {
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 1000,
  }
  if (remote) poolOptions.ssl = { rejectUnauthorized: true }
  const pool = new Pool(poolOptions)
  let lockClient
  let client
  let lockOpen = false
  try {
    lockClient = await pool.connect()
    if (remote) verifyD103RemoteTlsConnection(lockClient,target.parsed.hostname)
    await lockClient.query('BEGIN')
    lockOpen = true
    const identity = await lockClient.query(
      "SELECT current_database() AS database_name,current_setting('server_version_num')::integer AS version_num",
    )
    const major = Math.floor(Number(identity.rows[0]?.version_num) / 10000)
    const expectedDatabase = remote ? databaseName : manifest.localRehearsal.databaseName
    if (identity.rows[0]?.database_name !== expectedDatabase || major !== 18) {
      fail('connected database must be the exact D1-03 PostgreSQL 18 target')
    }
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('luckread:neon-schema-migration:' || current_database(),0))",
    )

    client = await pool.connect()
    if (remote) verifyD103RemoteTlsConnection(client,target.parsed.hostname)
    await verifyPublicSchema(client)
    const ledgerPresent = (await client.query(
      "SELECT to_regclass('public.neon_schema_migration_ledger') IS NOT NULL AS present",
    )).rows[0].present
    if (!ledgerPresent) await verifyEmptyBootstrapTarget(client)
    await ensureLedger(client)

    let ledgerRows = await readLedgerRows(client)
    let appliedEntries = assertLedgerPrefixRows(manifest,plan,ledgerRows)
    await verifyOwnerSchemaState(client,plan,appliedEntries.length)

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
      await verifyOwnerSchemaState(client,plan,appliedEntries.length)
    }

    const finalRows = await readLedgerRows(client)
    assertLedgerPrefixRows(manifest,plan,finalRows)
    if (finalRows.length !== plan.entries.length) fail('D1-03 runner did not commit every admitted migration')
    const catalog = await verifyFinalCatalog(client,manifest,plan)
    const report = {
      reportType: remote
        ? 'NEON_D1_03_PARTIAL_SCHEMA_REMOTE_POSTFLIGHT'
        : 'NEON_D1_03_PARTIAL_SCHEMA_LOCAL_POSTFLIGHT',
      status: remote ? 'D1_03_PARTIAL_SCHEMA_REMOTE_APPLY_PASS' : 'D1_03_PARTIAL_SCHEMA_LOCAL_POSTGRES18_PASS',
      domainId:'D1-03',
      databaseName: remote ? databaseName : manifest.localRehearsal.databaseName,
      scope:'ADMITTED_MANIFEST_ENTRIES_ONLY',
      partialRemoteApplyReady:remote,
      fullDomainSchemaComplete:false,
      postgresMajor:18,
      sourceCommitSha,
      runnerVersion,
      appliedMigrations:finalRows.map((row) => ({
        ownerWorker:row.owner_worker,
        logicalOwnerWorker:plan.entries.find((item) => item.entry.migrationId === row.migration_id)?.entry.logicalOwnerWorker || row.owner_worker,
        migrationId:row.migration_id,
        migrationOrder:Number(row.migration_order),
        migrationKind:row.migration_kind,
        artifactSha256:row.artifact_sha256,
        manifestEntrySha256:row.manifest_entry_sha256,
        sourceCommitSha:row.source_commit_sha,
      })),
      catalog,
      safety:{
        remoteNeonTouched:remote,
        cloudflareD1Touched:false,
        businessDataImported:false,
        runtimeBindingsChanged:false,
        productionCutoverAuthorized:false,
      },
      remoteApplyReady:false,
      remoteApplyBlockers:manifest.remoteApplyBlockers,
    }
    mkdirSync(dirname(resolve(root,output)),{recursive:true})
    writeFileSync(resolve(root,output),JSON.stringify(report,null,2) + String.fromCharCode(10))
    const result = {
      domainId:'D1-03',
      databaseName:report.databaseName,
      postgresMajor:18,
      migrations:finalRows.length,
      tables:catalog.tables,
      explicitIndexes:catalog.explicitIndexes,
      constraintIndexes:catalog.constraintIndexes,
      triggers:catalog.triggers,
      triggerFunctions:catalog.triggerFunctions,
      foreignKeys:catalog.foreignKeys,
      businessRows:catalog.businessRows,
      remoteNeonTouched:remote,
      cloudflareD1Touched:false,
      businessDataImported:false,
      productionCutoverAuthorized:false,
      fullDomainSchemaComplete:false,
    }
    process.stdout.write((remote ? 'NEON_D1_03_PARTIAL_SCHEMA_REMOTE_PASS ' : 'NEON_D1_03_PARTIAL_SCHEMA_LOCAL_PASS ') +
      JSON.stringify(result) + String.fromCharCode(10))
    return report
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

export async function runD103RemoteDomain(options = {}) {
  return runD103Domain({ ...options, mode: 'remote' })
}

export async function runD103LocalRehearsal(options = {}) {
  return runD103Domain({ ...options, mode: 'local' })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selection = parseCommandLine(process.argv.slice(2))
  if (!selection.valid) fail(selection.reason)
  const operation = selection.mode === 'REMOTE_NEON' ? runD103RemoteDomain : runD103LocalRehearsal
  operation().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + String.fromCharCode(10))
    process.exitCode = 1
  })
}
