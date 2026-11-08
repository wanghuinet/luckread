import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import tls from 'node:tls'

export const DATABASE_TARGETS = Object.freeze([
  { domainId: 'D1-01', database: 'luckread', secret: 'NEON_DATABASE_URL_LUCKREAD', authority: 'W01 / W02 / W07 / W08' },
  { domainId: 'D1-02', database: 'luckreadpro', secret: 'NEON_DATABASE_URL_LUCKREADPRO', authority: 'W03 / W05' },
  { domainId: 'D1-03', database: 'luckread_governance', secret: 'NEON_DATABASE_URL_GOVERNANCE', authority: 'W05 / W06 / W09' },
  { domainId: 'D1-04', database: 'luckread_finance', secret: 'NEON_DATABASE_URL_FINANCE', authority: 'W07' },
  { domainId: 'D1-05', database: 'allluck', secret: 'NEON_DATABASE_URL_ALLLUCK', authority: 'W11' },
])

const fail = (message) => {
  throw new Error('Neon five-database read-only preflight: ' + message)
}

const safeErrorCode = (error) => {
  const candidate = typeof error?.code === 'string' ? error.code : 'PREFLIGHT_FAILED'
  return /^[A-Za-z0-9_]{1,48}$/.test(candidate) ? candidate : 'PREFLIGHT_FAILED'
}

export function validateTargetConnectionString(connectionString, expectedDatabase) {
  if (typeof connectionString !== 'string' || connectionString.length === 0) {
    return { valid: false, code: 'MISSING_SECRET' }
  }

  let parsed
  try {
    parsed = new URL(connectionString)
  } catch {
    return { valid: false, code: 'INVALID_POSTGRES_URL' }
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    return { valid: false, code: 'INVALID_POSTGRES_PROTOCOL' }
  }
  if (!parsed.hostname.toLowerCase().endsWith('.neon.tech')) {
    return { valid: false, code: 'UNAPPROVED_DATABASE_HOST' }
  }
  let pathDatabase
  try {
    pathDatabase = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  } catch {
    return { valid: false, code: 'INVALID_DATABASE_PATH' }
  }
  if (pathDatabase !== expectedDatabase) {
    return { valid: false, code: 'DATABASE_URL_TARGET_MISMATCH' }
  }
  if (!['require', 'verify-ca', 'verify-full'].includes(parsed.searchParams.get('sslmode'))) {
    return { valid: false, code: 'TLS_REQUIRED' }
  }
  if (parsed.searchParams.get('channel_binding') !== 'require') {
    return { valid: false, code: 'CHANNEL_BINDING_REQUIRED' }
  }
  if (!parsed.username || !parsed.password) {
    return { valid: false, code: 'DATABASE_CREDENTIALS_MISSING' }
  }
  return { valid: true, parsed }
}

const sortedNames = (rows, keys) =>
  rows.map((row) => keys.map((key) => row[key]).join('.')).sort()

export function summarizeTargetInspection({
  target,
  actualDatabase,
  serverVersion,
  serverVersionNum,
  tlsChainVerified,
  tlsHostnameVerified,
  readOnlyTransactionVerified,
  schemas,
  relations,
  customTypes,
  routines,
  otherObjects,
  extensions,
  globalObjects,
  ledgerPresent,
  ledgerRows,
}) {
  const major = Math.floor(Number(serverVersionNum) / 10_000)
  const publicSchemaExists = schemas.includes('public')
  const extraSchemas = schemas.filter((schema) => schema !== 'public').sort()
  const catalog = {
    schemas: [...schemas].sort(),
    extraSchemas,
    relations: [...relations].sort(),
    customTypes: [...customTypes].sort(),
    routines: [...routines].sort(),
    otherObjects: [...otherObjects].sort(),
    nonDefaultExtensions: [...extensions].filter((name) => name !== 'plpgsql').sort(),
    globalObjects: [...globalObjects].sort(),
  }
  const issues = []
  if (actualDatabase !== target.database) issues.push('DATABASE_NAME_MISMATCH')
  if (major !== 18) issues.push('POSTGRESQL_18_REQUIRED')
  if (!tlsChainVerified) issues.push('TLS_CERTIFICATE_CHAIN_NOT_VERIFIED')
  if (!tlsHostnameVerified) issues.push('TLS_HOSTNAME_NOT_VERIFIED')
  if (!readOnlyTransactionVerified) issues.push('READ_ONLY_TRANSACTION_NOT_VERIFIED')
  if (!publicSchemaExists) issues.push('PUBLIC_SCHEMA_MISSING')
  if (extraSchemas.length) issues.push('UNEXPECTED_SCHEMAS')
  if (catalog.relations.length) issues.push('UNEXPECTED_RELATIONS')
  if (catalog.customTypes.length) issues.push('UNEXPECTED_CUSTOM_TYPES')
  if (catalog.routines.length) issues.push('UNEXPECTED_ROUTINES')
  if (catalog.otherObjects.length) issues.push('UNEXPECTED_SCHEMA_OBJECTS')
  if (catalog.nonDefaultExtensions.length) issues.push('UNEXPECTED_EXTENSIONS')
  if (catalog.globalObjects.length) issues.push('UNEXPECTED_GLOBAL_OBJECTS')
  if (ledgerPresent) issues.push('MIGRATION_LEDGER_ALREADY_EXISTS')

  const connectionAndIdentityValid =
    actualDatabase === target.database && major === 18 &&
    tlsChainVerified === true && tlsHostnameVerified === true && readOnlyTransactionVerified === true
  const clean = connectionAndIdentityValid && issues.length === 0 && ledgerPresent === false

  return {
    domainId: target.domainId,
    database: target.database,
    authority: target.authority,
    status: clean ? 'PASS_EMPTY' : (connectionAndIdentityValid ? 'BLOCKED_NOT_EMPTY' : 'FAIL'),
    serverVersion,
    postgresMajor: Number.isFinite(major) ? major : null,
    tlsChainVerified,
    tlsHostnameVerified,
    readOnlyTransactionVerified,
    channelBindingRequired: true,
    readOnlyTransactionRolledBack: true,
    migrationLedger: {
      present: ledgerPresent,
      rows: ledgerPresent ? ledgerRows : null,
      expectedState: 'ABSENT_BEFORE_SCHEMA_INITIALIZATION',
    },
    catalog,
    issues,
    ddlExecuted: false,
    businessDataImported: false,
    productionD1Touched: false,
  }
}

async function inspectTarget({ target, connectionString, Client }) {
  const validated = validateTargetConnectionString(connectionString, target.database)
  if (!validated.valid) {
    return {
      domainId: target.domainId,
      database: target.database,
      authority: target.authority,
      status: 'FAIL',
      errorCode: validated.code,
      ddlExecuted: false,
      businessDataImported: false,
      productionD1Touched: false,
    }
  }

  const { parsed } = validated
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    query_timeout: 15_000,
    statement_timeout: 15_000,
    enableChannelBinding: true,
  })
  let connected = false
  let transactionOpen = false

  try {
    await client.connect()
    connected = true
    const tlsSocket = client.connection?.stream
    const certificate = tlsSocket?.getPeerCertificate?.()
    const hostnameError = certificate
      ? tls.checkServerIdentity(parsed.hostname, certificate)
      : new Error('Peer certificate unavailable')
    const tlsChainVerified = tlsSocket?.encrypted === true && tlsSocket?.authorized === true
    const tlsHostnameVerified = tlsSocket?.encrypted === true && !hostnameError
    if (!tlsChainVerified || !tlsHostnameVerified) {
      return {
        domainId: target.domainId,
        database: target.database,
        authority: target.authority,
        status: 'FAIL',
        errorCode: 'TLS_VERIFICATION_FAILED',
        tlsChainVerified,
        tlsHostnameVerified,
        ddlExecuted: false,
        businessDataImported: false,
        productionD1Touched: false,
      }
    }

    await client.query('BEGIN READ ONLY')
    transactionOpen = true

    const identity = await client.query(
      'SELECT current_database() AS database_name, current_setting(\'server_version\') AS server_version, ' +
      'current_setting(\'server_version_num\')::integer AS server_version_num, ' +
      'current_setting(\'transaction_read_only\') AS transaction_read_only',
    )
    const actualDatabase = identity.rows[0]?.database_name
    const serverVersion = identity.rows[0]?.server_version
    const serverVersionNum = Number(identity.rows[0]?.server_version_num)
    const readOnlyTransactionVerified = identity.rows[0]?.transaction_read_only === 'on'
    if (!readOnlyTransactionVerified) {
      throw Object.assign(new Error('PostgreSQL transaction is not read-only.'), {
        code: 'READ_ONLY_TRANSACTION_NOT_VERIFIED',
      })
    }
    if (actualDatabase !== target.database) {
      throw Object.assign(new Error('Connected database name did not match the approved target.'), {
        code: 'DATABASE_NAME_MISMATCH',
      })
    }
    if (Math.floor(serverVersionNum / 10_000) !== 18) {
      throw Object.assign(new Error('Target database is not running PostgreSQL 18.'), {
        code: 'POSTGRESQL_18_REQUIRED',
      })
    }

    const schemaResult = await client.query(
      'SELECT nspname AS schema_name FROM pg_namespace ' +
      "WHERE nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%' " +
      'ORDER BY nspname',
    )
    const schemas = schemaResult.rows.map((row) => row.schema_name)

    const relationResult = await client.query(
      'SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind AS object_kind ' +
      'FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      "AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') " +
      'ORDER BY n.nspname, c.relname LIMIT 201',
    )
    const relations = relationResult.rows.map((row) =>
      row.schema_name + '.' + row.object_name + ':' + row.object_kind)

    const typeResult = await client.query(
      'SELECT n.nspname AS schema_name, t.typname AS type_name ' +
      'FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      "AND t.typtype IN ('c', 'd', 'e', 'r', 'm') " +
      'ORDER BY n.nspname, t.typname LIMIT 201',
    )
    const customTypes = sortedNames(typeResult.rows, ['schema_name', 'type_name'])

    const routineResult = await client.query(
      'SELECT n.nspname AS schema_name, p.proname AS object_name ' +
      'FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'ORDER BY n.nspname, p.proname LIMIT 201',
    )
    const routines = sortedNames(routineResult.rows, ['schema_name', 'object_name'])

    const otherResult = await client.query(
      "SELECT n.nspname AS schema_name, o.oprname AS object_name, 'operator' AS object_kind " +
      'FROM pg_operator o JOIN pg_namespace n ON n.oid = o.oprnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'UNION ALL ' +
      "SELECT n.nspname, c.collname, 'collation' FROM pg_collation c " +
      'JOIN pg_namespace n ON n.oid = c.collnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'UNION ALL ' +
      "SELECT n.nspname, c.conname, 'conversion' FROM pg_conversion c " +
      'JOIN pg_namespace n ON n.oid = c.connamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'UNION ALL ' +
      "SELECT n.nspname, t.cfgname, 'text_search_config' FROM pg_ts_config t " +
      'JOIN pg_namespace n ON n.oid = t.cfgnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'UNION ALL ' +
      "SELECT n.nspname, t.dictname, 'text_search_dictionary' FROM pg_ts_dict t " +
      'JOIN pg_namespace n ON n.oid = t.dictnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'UNION ALL ' +
      "SELECT n.nspname, t.prsname, 'text_search_parser' FROM pg_ts_parser t " +
      'JOIN pg_namespace n ON n.oid = t.prsnamespace ' +
      "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'UNION ALL ' +
      "SELECT n.nspname, t.tmplname, 'text_search_template' FROM pg_ts_template t " +
      'JOIN pg_namespace n ON n.oid = t.tmplnamespace ' +
      'WHERE n.nspname NOT IN (\'pg_catalog\', \'information_schema\') ' +
      "AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' " +
      'ORDER BY 1, 2 LIMIT 201',
    )
    const otherObjects = otherResult.rows.map((row) =>
      row.schema_name + '.' + row.object_name + ':' + row.object_kind)

    const extensionResult = await client.query(
      "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY extname",
    )
    const extensions = extensionResult.rows.map((row) => row.extname)

    const globalResult = await client.query(
      "SELECT evtname AS object_name, 'event_trigger' AS object_kind FROM pg_event_trigger " +
      'UNION ALL SELECT pubname, \'publication\' FROM pg_publication ' +
      'UNION ALL SELECT fdwname, \'foreign_data_wrapper\' FROM pg_foreign_data_wrapper ' +
      'UNION ALL SELECT srvname, \'foreign_server\' FROM pg_foreign_server ' +
      'ORDER BY 1 LIMIT 201',
    )
    const globalObjects = globalResult.rows.map((row) =>
      row.object_kind + ':' + row.object_name)

    const ledgerExistsResult = await client.query(
      "SELECT to_regclass('public.neon_schema_migration_ledger') IS NOT NULL AS present",
    )
    const ledgerPresent = ledgerExistsResult.rows[0]?.present === true
    let ledgerRows = null
    if (ledgerPresent) {
      const ledgerCount = await client.query(
        'SELECT COUNT(*)::bigint AS count FROM public.neon_schema_migration_ledger',
      )
      ledgerRows = Number(ledgerCount.rows[0].count)
    }

    const result = summarizeTargetInspection({
      target,
      actualDatabase,
      serverVersion,
      serverVersionNum,
      tlsChainVerified,
      tlsHostnameVerified,
      readOnlyTransactionVerified,
      schemas,
      relations,
      customTypes,
      routines,
      otherObjects,
      extensions,
      globalObjects,
      ledgerPresent,
      ledgerRows,
    })

    await client.query('ROLLBACK')
    transactionOpen = false
    result.sslMode = parsed.searchParams.get('sslmode')
    result.targetHostVerifiedAsNeon = true
    return result
  } catch (error) {
    return {
      domainId: target.domainId,
      database: target.database,
      authority: target.authority,
      status: 'FAIL',
      errorCode: safeErrorCode(error),
      ddlExecuted: false,
      businessDataImported: false,
      productionD1Touched: false,
    }
  } finally {
    if (transactionOpen) {
      try { await client.query('ROLLBACK') } catch {}
    }
    if (connected) {
      try { await client.end() } catch {}
    }
  }
}

export async function runPreflight({
  env = process.env,
  Client,
} = {}) {
  if (!Client) {
    const moduleRoot = process.env.NEON_PG_MODULE_ROOT
    if (!moduleRoot) fail('NEON_PG_MODULE_ROOT is required')
    const requireFromTemp = createRequire(resolve(moduleRoot, '..', 'package.json'))
    Client = requireFromTemp('pg').Client
  }

  const results = []
  for (const target of DATABASE_TARGETS) {
    results.push(await inspectTarget({
      target,
      connectionString: env[target.secret],
      Client,
    }))
  }

  const counts = {
    passEmpty: results.filter((item) => item.status === 'PASS_EMPTY').length,
    blocked: results.filter((item) => item.status === 'BLOCKED_NOT_EMPTY').length,
    failed: results.filter((item) => item.status === 'FAIL').length,
  }
  const report = {
    reportVersion: 1,
    status: counts.passEmpty === DATABASE_TARGETS.length ? 'PASS_EMPTY_5_OF_5' : 'PREFLIGHT_BLOCKED',
    inspectedAt: new Date().toISOString(),
    requiredPostgresMajor: 18,
    requiredReadOnly: true,
    requiredChannelBinding: true,
    databaseCount: DATABASE_TARGETS.length,
    counts,
    targets: results,
    safety: {
      remoteConnectionsWereReadOnly: true,
      allReadOnlyTransactionsWereRolledBack: true,
      ddlExecuted: false,
      businessDataImported: false,
      productionD1Touched: false,
      productionCutoverAuthorized: false,
      connectionStringsLogged: false,
      rowPayloadsRead: false,
    },
  }

  const reportPath = resolve(env.NEON_PREFLIGHT_REPORT || 'artifacts/neon/five-database-readonly-preflight.json')
  mkdirSync(dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')

  const summaryLines = [
    '# Neon five-database read-only target preflight',
    '',
    '| Domain | Database | PostgreSQL | TLS chain | TLS hostname | Ledger | Result |',
    '|---|---|---|---|---|---|---|',
    ...results.map((item) => {
      const ledger = item.migrationLedger
        ? (item.migrationLedger.present ? 'present (' + item.migrationLedger.rows + ' rows)' : 'absent (expected)')
        : 'not inspected'
      return '| ' + item.domainId + ' | ' + item.database + ' | ' +
        (item.serverVersion || 'n/a') + ' | ' +
        (item.tlsChainVerified ? 'verified' : 'not verified') + ' | ' +
        (item.tlsHostnameVerified ? 'verified' : 'not verified') + ' | ' +
        ledger + ' | **' + item.status + '** |'
    }),
    '',
    'The workflow only issues catalog SELECTs and (when present) a COUNT(*) against the migration ledger inside BEGIN READ ONLY, then rolls back. It never creates, alters or drops objects and never reads business row payloads.',
    '',
    'PASS_EMPTY means PostgreSQL 18, exact database identity, verified TLS chain and host, channel_binding=require, the default public schema only, no user-defined objects/extensions/global objects, and no migration ledger table.',
    '',
    'Any pre-existing object or ledger blocks bootstrap for manual inspection. No automatic cleanup or repair is performed.',
    '',
    'Connection strings, usernames, passwords and business row payloads are never logged.',
  ]
  const summary = summaryLines.join('\n') + '\n'
  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  }
  if (env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(
      env.GITHUB_OUTPUT,
      'pass_empty_count=' + counts.passEmpty + '\n' +
      'blocked_count=' + counts.blocked + '\n' +
      'failed_count=' + counts.failed + '\n',
    )
  }
  for (const item of results) {
    console.log(item.domainId + ' ' + item.database + ': ' + item.status +
      (item.errorCode ? ' (' + item.errorCode + ')' : ''))
  }
  console.log('Five-database preflight: ' + report.status)
  if (counts.passEmpty !== DATABASE_TARGETS.length) process.exitCode = 1
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  runPreflight().catch((error) => {
    console.error('Preflight stopped: ' + safeErrorCode(error))
    process.exitCode = 1
  })
}
