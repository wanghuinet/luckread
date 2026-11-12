import { appendFile } from 'node:fs/promises'

export const HYPERDRIVE_TARGETS = Object.freeze([
  { domainId: 'D1-01', database: 'luckread', secret: 'NEON_DATABASE_URL_LUCKREAD', configName: 'luckread-d1-01-neon' },
  { domainId: 'D1-02', database: 'luckreadpro', secret: 'NEON_DATABASE_URL_LUCKREADPRO', configName: 'luckreadpro-d1-02-neon' },
  { domainId: 'D1-03', database: 'luckread_governance', secret: 'NEON_DATABASE_URL_GOVERNANCE', configName: 'luckread-governance-d1-03-neon' },
  { domainId: 'D1-04', database: 'luckread_finance', secret: 'NEON_DATABASE_URL_FINANCE', configName: 'luckread-finance-d1-04-neon' },
  { domainId: 'D1-05', database: 'allluck', secret: 'NEON_DATABASE_URL_ALLLUCK', configName: 'allluck-d1-05-neon' },
])
export const HYPERDRIVE_CONFIG_NAME = HYPERDRIVE_TARGETS[0].configName
export const HYPERDRIVE_DATABASE_NAME = HYPERDRIVE_TARGETS[0].database

const API_BASE = 'https://api.cloudflare.com/client/v4'

function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Required configuration is missing: ${name}`)
  }
  return value.trim()
}

export function parseNeonConnectionString(connectionString, expectedDatabase = HYPERDRIVE_DATABASE_NAME) {
  let parsed
  try {
    parsed = new URL(required(connectionString, 'NEON_DATABASE_URL_LUCKREAD'))
  } catch {
    throw new Error('NEON_DATABASE_URL_LUCKREAD is not a valid PostgreSQL connection URL')
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('D1-01 Hyperdrive target must use PostgreSQL')
  }

  const host = parsed.hostname.toLowerCase()
  if (!host.endsWith('.neon.tech')) {
    throw new Error('D1-01 Hyperdrive target must be hosted on Neon')
  }
  if (/-pooler(?:\.|$)/i.test(host)) {
    throw new Error('D1-01 Hyperdrive requires the Neon direct (non-pooler) endpoint')
  }

  let database
  let user
  let password
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
    user = decodeURIComponent(parsed.username)
    password = decodeURIComponent(parsed.password)
  } catch {
    throw new Error('Neon connection URL contains invalid percent-encoding')
  }

  if (database !== HYPERDRIVE_DATABASE_NAME) {
    throw new Error(`Hyperdrive target database must be exactly ${expectedDatabase}`)
  }
  if (!user || !password) {
    throw new Error('Neon connection URL must include a database user and password')
  }
  if (parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error('Neon connection URL must declare sslmode=require for Hyperdrive TLS')
  }

  const port = parsed.port === '' ? 5432 : Number(parsed.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Neon connection URL contains an invalid PostgreSQL port')
  }

  return Object.freeze({
    database,
    host,
    password,
    port,
    scheme: 'postgres',
    user,
  })
}

async function cloudflareRequest({ accountId, apiToken, fetchImpl, method, path, body }) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Cloudflare Hyperdrive API returned a non-JSON response (HTTP ${response.status})`)
  }

  if (!response.ok || payload?.success !== true) {
    const codes = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.code).filter((code) => Number.isInteger(code)).join(',')
      : ''
    throw new Error(
      `Cloudflare Hyperdrive API ${method} failed (HTTP ${response.status}${codes ? `, error codes ${codes}` : ''})`,
    )
  }

  return payload
}

async function listHyperdriveConfigs({ accountId, apiToken, fetchImpl }) {
  const all = []
  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: '100' })
    const payload = await cloudflareRequest({
      accountId,
      apiToken,
      fetchImpl,
      method: 'GET',
      path: `/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs?${params}`,
    })
    if (!Array.isArray(payload.result)) {
      throw new Error('Cloudflare Hyperdrive list response did not contain a configuration array')
    }

    all.push(...payload.result)
    const totalPages = Number(payload.result_info?.total_pages)
    if (Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) return all
    } else if (payload.result.length < 100) {
      return all
    }
  }

  throw new Error('Cloudflare Hyperdrive listing exceeded the 100-page safety limit')
}

function matchesExpectedOrigin(config, expected) {
  const actual = config?.origin
  return (
    actual?.host?.toLowerCase() === expected.host &&
    actual?.database === expected.database &&
    actual?.user === expected.user &&
    Number(actual?.port ?? 5432) === expected.port &&
    ['postgres', 'postgresql'].includes(actual?.scheme) &&
    config?.caching?.disabled === true
  )
}

export async function ensureHyperdriveConfig({
  accountId,
  apiToken,
  connectionString,
  target,
  fetchImpl = fetch,
}) {
  accountId = required(accountId, 'CLOUDFLARE_ACCOUNT_ID')
  apiToken = required(apiToken, 'CLOUDFLARE_HYPERDRIVE_API_TOKEN')
  if (
    !target ||
    typeof target.database !== 'string' ||
    typeof target.configName !== 'string' ||
    typeof target.domainId !== 'string'
  ) {
    throw new Error('A registered Neon database target is required')
  }

  const origin = parseNeonConnectionString(connectionString, target.database)
  const configs = await listHyperdriveConfigs({ accountId, apiToken, fetchImpl })
  const named = configs.filter((config) => config?.name === target.configName)

  if (named.length > 1) {
    throw new Error(`Multiple Cloudflare Hyperdrive configurations use the reserved name ${target.configName}`)
  }

  if (named.length === 1) {
    const existing = named[0]
    if (!matchesExpectedOrigin(existing, origin)) {
      throw new Error(
        `Existing Hyperdrive config ${target.configName} does not match the approved ${target.domainId} target; refusing to update it`,
      )
    }
    if (typeof existing.id !== 'string' || existing.id.length === 0) {
      throw new Error('Existing Hyperdrive config is missing its identifier')
    }
    return Object.freeze({ created: false, id: existing.id, name: target.configName })
  }

  const payload = await cloudflareRequest({
    accountId,
    apiToken,
    fetchImpl,
    method: 'POST',
    path: `/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs`,
    body: {
      name: target.configName,
      origin,
      // Keep SQL response caching disabled until application-level cache semantics
      // have been explicitly accepted for each Worker owner.
      caching: { disabled: true },
      // Hyperdrive negotiates TLS to the public Neon origin by default.
    },
  })

  const created = payload.result
  if (
    typeof created?.id !== 'string' ||
    created.name !== target.configName ||
    !matchesExpectedOrigin(created, origin)
  ) {
    throw new Error(`Cloudflare created ${target.domainId} Hyperdrive but returned metadata failed target verification`)
  }

  return Object.freeze({ created: true, id: created.id, name: target.configName })
}

export async function ensureD1_01Hyperdrive(options) {
  return ensureHyperdriveConfig({
    ...options,
    target: HYPERDRIVE_TARGETS[0],
  })
}

export async function ensureAllFiveNeonHyperdrive({
  accountId,
  apiToken,
  connectionStrings,
  fetchImpl = fetch,
}) {
  accountId = required(accountId, 'CLOUDFLARE_ACCOUNT_ID')
  apiToken = required(apiToken, 'CLOUDFLARE_HYPERDRIVE_API_TOKEN')
  if (!connectionStrings || typeof connectionStrings !== 'object') {
    throw new Error('All five Neon database connection strings are required')
  }

  // Validate every secret and exact database identity before the first Cloudflare
  // write. A bad URL therefore cannot create a partially configured batch.
  const prepared = HYPERDRIVE_TARGETS.map((target) => {
    const connectionString = connectionStrings[target.secret]
    parseNeonConnectionString(connectionString, target.database)
    return { target, connectionString }
  })

  const results = []
  for (const item of prepared) {
    const result = await ensureHyperdriveConfig({
      accountId,
      apiToken,
      connectionString: item.connectionString,
      target: item.target,
      fetchImpl,
    })
    results.push({
      domainId: item.target.domainId,
      database: item.target.database,
      ...result,
    })
  }
  return results
}

async function main() {
  const allowedTargets = [
    'CREATE_D1_01_NEON_HYPERDRIVE',
    'CREATE_ALL_FIVE_NEON_HYPERDRIVE',
  ]
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    !allowedTargets.includes(process.env.CONFIRM_TARGET)
  ) {
    throw new Error('Hyperdrive provisioning is restricted to a confirmed workflow_dispatch on main')
  }

  let results
  if (process.env.CONFIRM_TARGET === 'CREATE_D1_01_NEON_HYPERDRIVE') {
    const result = await ensureD1_01Hyperdrive({
      accountId: process.env.CF_ACCOUNT_ID,
      apiToken: process.env.CF_API_TOKEN,
      connectionString: process.env.NEON_DATABASE_URL_LUCKREAD,
    })
    results = [{ domainId: 'D1-01', database: 'luckread', ...result }]
  } else {
    results = await ensureAllFiveNeonHyperdrive({
      accountId: process.env.CF_ACCOUNT_ID,
      apiToken: process.env.CF_API_TOKEN,
      connectionStrings: Object.fromEntries(
        HYPERDRIVE_TARGETS.map((target) => [target.secret, process.env[target.secret]]),
      ),
    })
  }

  const summary = results.map((item) =>
    `${item.domainId} ${item.database}: ${item.name} (id=${item.id}, created=${item.created})`,
  ).join('\n')

  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `hyperdrive_summary<<HYPERDRIVE_SUMMARY\n${summary}\nHYPERDRIVE_SUMMARY\n`,
      'utf8',
    )
  }

  console.log(summary)
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Hyperdrive provisioning failed')
    process.exitCode = 1
  })
}
