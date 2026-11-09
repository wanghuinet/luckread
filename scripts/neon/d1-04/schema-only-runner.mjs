import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tls from 'node:tls'
import {
  DOMAIN_MANIFESTS,
  buildDomainPlan,
  assertLedgerPrefixRows,
  stripOuterTransaction,
} from '../shared-domain-schema-runner.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const requireFromW02 = createRequire(resolve(repositoryRoot, 'workers/W02-identity/package.json'))
const manifestPath = DOMAIN_MANIFESTS['D1-04']
const ledgerSqlPath = 'scripts/neon/d1-01/0001_schema_migration_ledger.sql'
const ledgerTable = 'neon_schema_migration_ledger'
const ledgerFunction = 'neon_schema_migration_ledger_reject_mutation'
const databaseName = 'luckread_finance'
const databaseUuid = '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736'
const approvedNeonHost = 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech'
const remoteConfirmation = 'APPLY_REVIEWED_SCHEMA_D1_04_FINANCE'
const runnerVersion = 'd1-04-schema-runner/1.0.0'
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const fail = (message) => { throw new Error('D1-04 schema-only runner: ' + message) }
const readJson = (file) => JSON.parse(readFileSync(resolve(repositoryRoot, file), 'utf8'))

export function validateRemoteNeonTarget(connectionString) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, reason: 'NEON_DATABASE_URL_FINANCE is required' }
  }
  let parsed
  try { parsed = new URL(connectionString) } catch {
    return { valid: false, reason: 'Neon database URL is invalid' }
  }
  let targetDatabase
  try { targetDatabase = decodeURIComponent(parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname) } catch {
    targetDatabase = ''
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      parsed.hostname.toLowerCase() !== approvedNeonHost ||
      !['', '5432'].includes(parsed.port) || targetDatabase !== databaseName) {
    return { valid: false, reason: 'remote runner accepts only the pinned Neon endpoint and D1-04 luckread_finance database' }
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

export function validateRemoteApplyContext({ githubActions, githubRef, confirmation } = {}) {
  const errors = []
  if (githubActions !== 'true') errors.push('remote apply is permitted only inside GitHub Actions')
  if (githubRef !== 'refs/heads/main') errors.push('remote apply is permitted only from the main branch')
  if (confirmation !== remoteConfirmation) errors.push('exact D1-04 remote apply confirmation is required')
  return { valid: errors.length === 0, errors }
}

export function parseCommandLine(argv) {
  if (argv.length !== 1 || argv[0] !== '--remote-neon') {
    return { valid: false, reason: 'select exactly: --remote-neon (local rehearsals use the shared local-only executor)' }
  }
  return { valid: true, mode: 'REMOTE_NEON' }
}

export function verifyRemoteTlsConnection(client, hostname = approvedNeonHost) {
  const socket = client?.connection?.stream
  const certificate = socket?.getPeerCertificate?.()
  const identityError = certificate ? tls.checkServerIdentity(hostname, certificate) : new Error('peer certificate unavailable')
  if (socket?.encrypted !== true || socket?.authorized !== true || identityError) {
    fail('Neon TLS certificate chain or hostname verification failed')
  }
  return true
}

export function assertD104LedgerRows(manifest, plan, rows) {
  if (!Array.isArray(rows) || rows.some((row) =>
    row.domain_id !== 'D1-04' || row.database_name !== databaseName)) {
    fail('D1-04 database contains a ledger row for another logical domain or database')
  }
  return assertLedgerPrefixRows(manifest, plan, rows)
}

export function assertD104ExactIndexNames(expectedIndexNames, actualIndexNames) {
  if (!Array.isArray(expectedIndexNames) || !Array.isArray(actualIndexNames)) {
    fail('D1-04 explicit index verification requires two index-name arrays')
  }
  const expected = [...expectedIndexNames].sort()
  const actual = [...actualIndexNames].sort()
  const missing = expected.filter((name) => !actual.includes(name))
  const unexpected = actual.filter((name) => !expected.includes(name))
  if (missing.length || unexpected.length || new Set(actual).size !== actual.length) {
    fail('actual D1-04 explicit index set differs from the reviewed manifest: missing=[' +
      missing.join(',') + '] unexpected=[' + unexpected.join(',') + ']')
  }
  return actual.length
}

function safeName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) {
    fail('unsafe PostgreSQL identifier encountered during catalog verification')
  }
  return name
}

async function verifyPublicNamespace(client) {
  const schemas = await client.query(
    "SELECT nspname FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' ORDER BY nspname",
  )
  if (JSON.stringify(schemas.rows.map((row) => row.nspname)) !== JSON.stringify(['public'])) {
    fail('only the default public schema is admitted; unexpected non-system schema exists')
  }
}

async function verifyEmptyBootstrapTarget(client) {
  await verifyPublicNamespace(client)
  const relations = await client.query(
    "SELECT c.relname,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%' ORDER BY c.relname",
  )
  if (relations.rows.length !== 0) fail('first D1-04 apply requires an empty public schema; existing relations were found')
  const types = await client.query(
    "SELECT t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('c','d','e','r','m') ORDER BY t.typname",
  )
  if (types.rows.length !== 0) fail('first D1-04 apply requires no pre-existing public custom types')
  const routines = await client.query(
    "SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname",
  )
  if (routines.rows.length !== 0) fail('first D1-04 apply requires no pre-existing public routines')
  const otherObjects = await client.query(
    "SELECT o.oprname AS object_name,'operator' AS object_kind FROM pg_catalog.pg_operator o JOIN pg_catalog.pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname='public' " +
    "UNION ALL SELECT c.collname,'collation' FROM pg_catalog.pg_collation c JOIN pg_catalog.pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname='public' " +
    "UNION ALL SELECT c.conname,'conversion' FROM pg_catalog.pg_conversion c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' " +
    "UNION ALL SELECT t.cfgname,'text_search_config' FROM pg_catalog.pg_ts_config t JOIN pg_catalog.pg_namespace n ON n.oid=t.cfgnamespace WHERE n.nspname='public' " +
    "UNION ALL SELECT t.dictname,'text_search_dictionary' FROM pg_catalog.pg_ts_dict t JOIN pg_catalog.pg_namespace n ON n.oid=t.dictnamespace WHERE n.nspname='public' " +
    "UNION ALL SELECT t.prsname,'text_search_parser' FROM pg_catalog.pg_ts_parser t JOIN pg_catalog.pg_namespace n ON n.oid=t.prsnamespace WHERE n.nspname='public' " +
    "UNION ALL SELECT t.tmplname,'text_search_template' FROM pg_catalog.pg_ts_template t JOIN pg_catalog.pg_namespace n ON n.oid=t.tmplnamespace WHERE n.nspname='public'",
  )
  if (otherObjects.rows.length !== 0) fail('first D1-04 apply requires no pre-existing public schema objects')
  const extensions = await client.query(
    "SELECT extname FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
  )
  if (extensions.rows.length !== 0) fail('only the PostgreSQL default plpgsql extension is admitted before bootstrap')
  const globalObjects = await client.query(
    "SELECT evtname AS object_name,'event_trigger' AS object_kind FROM pg_catalog.pg_event_trigger " +
    "UNION ALL SELECT pubname,'publication' FROM pg_catalog.pg_publication " +
    "UNION ALL SELECT fdwname,'foreign_data_wrapper' FROM pg_catalog.pg_foreign_data_wrapper " +
    "UNION ALL SELECT srvname,'foreign_server' FROM pg_catalog.pg_foreign_server",
  )
  if (globalObjects.rows.length !== 0) fail('unexpected database-global PostgreSQL objects block D1-04 bootstrap')
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
  const columnByName = new Map(columns.rows.map((row) => [row.column_name, row]))
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
    fail('shared append-only migration ledger index set does not match its contract')
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
    await verifyEmptyBootstrapTarget(client)
    const sql = stripOuterTransaction(readFileSync(resolve(repositoryRoot, ledgerSqlPath), 'utf8'), 'shared-ledger')
    await client.query('BEGIN')
    try {
      await client.query(sql)
      await client.query('COMMIT')
    } catch (error) {
      try { await client.query('ROLLBACK') } catch {}
      throw error
    }
  }
  await verifyPublicNamespace(client)
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

async function verifyAppliedTableState(client, manifest, plan, appliedCount) {
  const applied = plan.entries.slice(0, appliedCount)
  const expectedTables = applied.flatMap((item) => item.effects.tables).sort()
  const relationResult = await client.query(
    "SELECT c.relname,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname NOT LIKE 'pg_%' ORDER BY c.relname",
  )
  const actualRelations = relationResult.rows.map((row) => row.relname)
  const expectedRelations = [ledgerTable, ...expectedTables].sort()
  if (JSON.stringify(actualRelations) !== JSON.stringify(expectedRelations)) {
    const missing = expectedRelations.filter((name) => !actualRelations.includes(name))
    const unexpected = actualRelations.filter((name) => !expectedRelations.includes(name))
    fail('public relation set differs from the applied D1-04 ledger prefix; missing=[' +
      missing.join(',') + '] unexpected=[' + unexpected.join(',') + ']')
  }

  const rowCounts = {}
  const expectedPrefixControlSeedRows = expectedTables.reduce((total, table) =>
    total + (plan.seedRowsByTable.get(table)?.length ?? 0), 0)
  let controlSeedRows = 0
  for (const table of expectedTables) {
    safeName(table)
    const result = await client.query('SELECT COUNT(*)::bigint AS count FROM public."' + table + '"')
    const count = Number(result.rows[0].count)
    const seeds = plan.seedRowsByTable.get(table) ?? []
    rowCounts[table] = count
    if (count !== seeds.length) {
      fail(seeds.length === 0 ? 'business table must remain empty: ' + table :
        'schema-control seed row count differs from the exact reviewed manifest: ' + table)
    }
    for (const seed of seeds) {
      const columns = Object.keys(seed)
      if (columns.length === 0) fail('schema-control seed row cannot be empty')
      const predicate = columns.map((column, index) => '"' + safeName(column) +
        '" IS NOT DISTINCT FROM $' + (index + 1)).join(' AND ')
      const matched = await client.query(
        'SELECT COUNT(*)::bigint AS count FROM public."' + table + '" WHERE ' + predicate,
        columns.map((column) => seed[column]),
      )
      if (Number(matched.rows[0].count) !== 1) {
        fail('schema-control seed row does not match the exact admitted values: ' + table)
      }
      controlSeedRows++
    }
  }
  if (controlSeedRows !== expectedPrefixControlSeedRows) {
    fail('actual schema-control seed row count does not match the applied manifest prefix')
  }
  if (appliedCount === plan.entries.length &&
      controlSeedRows !== manifest.expected.controlSeedRows) {
    fail('final schema-control seed count does not match the reviewed D1-04 contract')
  }
  return { tableCount: expectedTables.length, tableRowCounts: rowCounts, controlSeedRows, businessRows: 0 }
}

async function verifyFinalCatalog(client, manifest, plan) {
  const tableState = await verifyAppliedTableState(client, manifest, plan, plan.entries.length)
  const indexRows = await client.query(
    "SELECT indexname FROM pg_catalog.pg_indexes WHERE schemaname='public' AND tablename <> $1 ORDER BY indexname",
    [ledgerTable],
  )
  const explicitIndexes = assertD104ExactIndexNames(
    plan.indexes,
    indexRows.rows.map((row) => row.indexname),
  )
  if (explicitIndexes !== manifest.expected.explicitIndexes) {
    fail('actual D1-04 explicit index count does not match the reviewed manifest')
  }

  const triggerRows = await client.query(
    "SELECT t.tgname FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname <> $1 AND NOT t.tgisinternal ORDER BY t.tgname",
    [ledgerTable],
  )
  const actualTriggers = triggerRows.rows.map((row) => row.tgname)
  if (JSON.stringify(actualTriggers) !== JSON.stringify(plan.triggers)) {
    fail('actual D1-04 trigger set does not match the ordered W07 migration artifacts')
  }

  const functionRows = await client.query(
    "SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f' AND p.proname <> $1 ORDER BY p.proname",
    [ledgerFunction],
  )
  const actualFunctions = functionRows.rows.map((row) => row.proname)
  if (JSON.stringify(actualFunctions) !== JSON.stringify(plan.functions)) {
    fail('actual D1-04 trigger-function set does not match the ordered W07 migration artifacts')
  }

  const foreignKeys = await client.query(
    "SELECT COUNT(*)::integer AS count FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND c.contype='f' AND c.conrelid <> $1::regclass",
    ['public.' + ledgerTable],
  )
  if (Number(foreignKeys.rows[0].count) !== manifest.expected.foreignKeys) {
    fail('D1-04 foreign-key count does not match the reviewed contract')
  }
  return {
    ...tableState,
    tables: tableState.tableCount,
    explicitIndexes,
    triggers: plan.triggers.length,
    triggerFunctions: plan.functions.length,
    foreignKeys: Number(foreignKeys.rows[0].count),
  }
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

export async function runD104RemoteApply({
  env = process.env,
  Pool,
  readManifest = () => readJson(manifestPath),
  root = repositoryRoot,
} = {}) {
  const context = validateRemoteApplyContext({
    githubActions: env.GITHUB_ACTIONS,
    githubRef: env.GITHUB_REF,
    confirmation: env.D1_04_REMOTE_APPLY_CONFIRMATION,
  })
  if (!context.valid) fail(context.errors.join('; '))

  const rawConnectionString = env.NEON_DATABASE_URL_FINANCE_VERIFIED || env.NEON_DATABASE_URL_FINANCE
  const target = validateRemoteNeonTarget(rawConnectionString)
  if (!target.valid) fail(target.reason)
  const connectionString = enforceVerifiedNeonConnectionString(rawConnectionString)
  const sourceCommitSha = env.GITHUB_SHA
  if (!SHA.test(sourceCommitSha || '')) fail('an exact GitHub source commit SHA is required for migration provenance')

  const manifest = readManifest()
  const plan = buildDomainPlan(manifest, {
    readBytes: (relativePath) => readFileSync(resolve(root, relativePath)),
    readSource: (relativePath) => readFileSync(resolve(root, relativePath), 'utf8'),
  })
  if (manifest.domainId !== 'D1-04' || manifest.databaseName !== databaseName ||
      manifest.cloudflareD1DatabaseUuid !== databaseUuid ||
      manifest.postgresMajor !== 18 || manifest.remoteApplyReady !== false ||
      manifest.businessDataImport !== false || manifest.productionCutoverAuthorized !== false) {
    fail('D1-04 source manifest must remain the exact reviewed finance schema-only contract with its original local-only flag')
  }

  if (!Pool) {
    const { Pool: PgPool } = requireFromW02('pg')
    Pool = PgPool
  }
  const executionId = 'github-' + (env.GITHUB_RUN_ID || 'manual') + '-' + (env.GITHUB_RUN_ATTEMPT || '1')
  const pool = new Pool({
    connectionString,
    max: 2,
    ssl: { rejectUnauthorized: true },
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
    verifyRemoteTlsConnection(lockClient, target.parsed.hostname)
    const identity = await lockClient.query(
      "SELECT current_database() AS database_name,current_setting('server_version_num')::integer AS version_num",
    )
    const major = Math.floor(Number(identity.rows[0]?.version_num) / 10000)
    if (identity.rows[0]?.database_name !== databaseName || major !== 18) {
      fail('connected database must be the exact D1-04 luckread_finance PostgreSQL 18 target')
    }
    await lockClient.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('luckread:neon-schema-migration:' || current_database(),0))",
    )

    client = await pool.connect()
    verifyRemoteTlsConnection(client, target.parsed.hostname)
    await ensureLedger(client)
    let ledgerRows = await readLedgerRows(client)
    let appliedEntries = assertD104LedgerRows(manifest, plan, ledgerRows)
    await verifyAppliedTableState(client, manifest, plan, appliedEntries.length)

    for (const item of plan.entries.slice(appliedEntries.length)) {
      for (const dependency of item.entry.dependsOn ?? []) {
        if (!appliedEntries.some((entry) => entry.migrationId === dependency)) {
          fail('migration dependency has not been committed: ' + dependency)
        }
      }
      await client.query('BEGIN')
      try {
        await client.query(item.body)
        await insertLedgerRow(client, manifest, item, sourceCommitSha, executionId)
        await client.query('COMMIT')
      } catch (error) {
        try { await client.query('ROLLBACK') } catch {}
        throw error
      }
      appliedEntries = [...appliedEntries, item.entry]
      ledgerRows = await readLedgerRows(client)
      assertD104LedgerRows(manifest, plan, ledgerRows)
      await verifyAppliedTableState(client, manifest, plan, appliedEntries.length)
    }

    const finalRows = await readLedgerRows(client)
    assertD104LedgerRows(manifest, plan, finalRows)
    if (finalRows.length !== plan.entries.length) fail('D1-04 runner did not commit all six ordered W07 migrations')
    const catalog = await verifyFinalCatalog(client, manifest, plan)
    const report = {
      reportType: 'NEON_D1_04_SCHEMA_ONLY_RUNNER_REMOTE_POSTFLIGHT',
      status: 'D1_04_REMOTE_SCHEMA_ONLY_APPLY_PASS',
      domainId: 'D1-04',
      databaseName,
      databaseUuid,
      postgresMajor: 18,
      sourceCommitSha,
      runnerVersion,
      appliedMigrations: finalRows.map((row) => ({
        ownerWorker: row.owner_worker,
        migrationId: row.migration_id,
        migrationOrder: Number(row.migration_order),
        migrationKind: row.migration_kind,
        artifactSha256: row.artifact_sha256,
        manifestEntrySha256: row.manifest_entry_sha256,
        sourceCommitSha: row.source_commit_sha,
      })),
      catalog,
      safety: {
        remoteNeonTouched: true,
        cloudflareD1Touched: false,
        businessDataImported: false,
        productionCutoverAuthorized: false,
        runtimeBindingsChanged: false,
      },
    }
    const output = env.D1_04_SCHEMA_APPLY_REPORT ||
      'artifacts/neon/d1-04-schema-runner-remote-postflight.json'
    const absoluteOutput = resolve(root, output)
    if (!absoluteOutput.startsWith(resolve(root) + '/') || output.includes('..')) {
      fail('remote postflight report path must remain inside the repository')
    }
    mkdirSync(dirname(absoluteOutput), { recursive: true })
    writeFileSync(absoluteOutput, JSON.stringify(report, null, 2) + '\n')
    process.stdout.write('NEON_D1_04_REMOTE_SCHEMA_ONLY_RUNNER_PASS ' + JSON.stringify({
      databaseName,
      postgresMajor: 18,
      appliedMigrations: finalRows.length,
      tables: catalog.tables,
      explicitIndexes: catalog.explicitIndexes,
      triggers: catalog.triggers,
      triggerFunctions: catalog.triggerFunctions,
      foreignKeys: catalog.foreignKeys,
      controlSeedRows: catalog.controlSeedRows,
      businessRows: 0,
      remoteNeonTouched: true,
      cloudflareD1Touched: false,
      businessDataImported: false,
      productionCutoverAuthorized: false,
    }) + '\n')
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

async function run() {
  const selection = parseCommandLine(process.argv.slice(2))
  if (!selection.valid) fail(selection.reason)
  await runD104RemoteApply()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n')
    process.exitCode = 1
  })
}
