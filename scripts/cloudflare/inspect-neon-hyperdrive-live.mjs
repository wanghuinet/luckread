import { appendFile, mkdir, writeFile } from 'node:fs/promises'

export const EXPECTED_HYPERDRIVES = Object.freeze([
  { domainId: 'D1-01', database: 'luckread', name: 'luckread-d1-01-neon' },
  { domainId: 'D1-02', database: 'luckreadpro', name: 'luckreadpro-d1-02-neon' },
  { domainId: 'D1-03', database: 'luckread_governance', name: 'luckread-governance-d1-03-neon' },
  { domainId: 'D1-04', database: 'luckread_finance', name: 'luckread-finance-d1-04-neon' },
  { domainId: 'D1-05', database: 'allluck', name: 'allluck-d1-05-neon' },
])

export const WORKER_SCRIPTS = Object.freeze([
  { worker: 'W01', script: 'luckread-w01-payload' },
  { worker: 'W02', script: 'luckread-w02' },
  { worker: 'W03', script: 'luckread-w03' },
  { worker: 'W04', script: 'luckread-w04' },
  { worker: 'W05', script: 'luckread-w05' },
  { worker: 'W06', script: 'luckread-w06' },
  { worker: 'W07', script: 'luckread-w07' },
  { worker: 'W08', script: 'luckread-w08-creator' },
  { worker: 'W09', script: 'luckread-w09' },
  { worker: 'W10', script: 'luckread-w10' },
  { worker: 'W11', script: 'luckread-w11' },
  { worker: 'W12', script: 'luckread-w12' },
])

const API_BASE = 'https://api.cloudflare.com/client/v4'
const OUTPUT_PATH = 'artifacts/cloudflare-neon-hyperdrive-live-inventory.json'

function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Required configuration is missing: ${name}`)
  }
  return value.trim()
}

async function getJson({ accountId, apiToken, fetchImpl, path }) {
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 404) {
    return { notFound: true, httpStatus: 404 }
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Cloudflare read-only inventory API returned non-JSON (HTTP ${response.status})`)
  }

  if (!response.ok || payload?.success !== true) {
    const errorCodes = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.code).filter(Number.isInteger)
      : []
    return { unavailable: true, httpStatus: response.status, errorCodes }
  }

  return { payload }
}

export async function listHyperdrives({ accountId, apiToken, fetchImpl = fetch }) {
  const result = []
  for (let page = 1; page <= 100; page += 1) {
    const params = new URLSearchParams({ page: String(page), per_page: '100' })
    const response = await getJson({
      accountId,
      apiToken,
      fetchImpl,
      path: `/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs?${params}`,
    })
    if (response.notFound || response.unavailable) {
      throw new Error(`Cloudflare Hyperdrive list read failed (HTTP ${response.httpStatus})`)
    }

    const payload = response.payload
    if (!Array.isArray(payload?.result)) {
      throw new Error('Cloudflare Hyperdrive list response did not contain a configuration array')
    }
    result.push(...payload.result)

    const totalPages = Number(payload.result_info?.total_pages)
    if (Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) return result
    } else if (payload.result.length < 100) {
      return result
    }
  }

  throw new Error('Cloudflare Hyperdrive listing exceeded the 100-page safety limit')
}

function inspectExpectedHyperdrive(configs, expected) {
  const matchingNames = configs.filter((config) => config?.name === expected.name)
  if (matchingNames.length === 0) {
    return {
      domainId: expected.domainId,
      database: expected.database,
      name: expected.name,
      status: 'MISSING',
      matchesExpectedTarget: false,
    }
  }
  if (matchingNames.length > 1) {
    return {
      domainId: expected.domainId,
      database: expected.database,
      name: expected.name,
      status: 'DUPLICATE_NAME',
      matchingResourceCount: matchingNames.length,
      matchesExpectedTarget: false,
    }
  }

  const config = matchingNames[0]
  const host = typeof config?.origin?.host === 'string' ? config.origin.host.toLowerCase() : ''
  const checks = {
    databaseMatches: config?.origin?.database === expected.database,
    neonHost: host.endsWith('.neon.tech'),
    directEndpoint: host !== '' && !/-pooler(?:\.|$)/i.test(host),
    postgresScheme: ['postgres', 'postgresql'].includes(config?.origin?.scheme),
    cachingDisabled: config?.caching?.disabled === true,
    resourceIdPresent: typeof config?.id === 'string' && config.id.length > 0,
  }
  const matchesExpectedTarget = Object.values(checks).every(Boolean)
  return {
    domainId: expected.domainId,
    database: expected.database,
    name: expected.name,
    id: typeof config?.id === 'string' ? config.id : null,
    status: matchesExpectedTarget ? 'MATCH' : 'MISMATCH',
    checks,
    matchesExpectedTarget,
  }
}

async function inspectWorker({ accountId, apiToken, fetchImpl, expected, configById }) {
  const response = await getJson({
    accountId,
    apiToken,
    fetchImpl,
    path: `/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(expected.script)}/settings`,
  })

  if (response.notFound) {
    return {
      worker: expected.worker,
      script: expected.script,
      status: 'NOT_FOUND',
      httpStatus: response.httpStatus,
      hyperdriveBindings: [],
      d1BindingNames: [],
    }
  }
  if (response.unavailable) {
    return {
      worker: expected.worker,
      script: expected.script,
      status: 'UNAVAILABLE',
      httpStatus: response.httpStatus,
      errorCodes: response.errorCodes,
      hyperdriveBindings: [],
      d1BindingNames: [],
    }
  }

  const bindings = response.payload?.result?.bindings
  if (!Array.isArray(bindings)) {
    return {
      worker: expected.worker,
      script: expected.script,
      status: 'INVALID_RESPONSE',
      hyperdriveBindings: [],
      d1BindingNames: [],
    }
  }

  const hyperdriveBindings = bindings
    .filter((binding) => String(binding?.type ?? '').toLowerCase() === 'hyperdrive')
    .map((binding) => {
      const target = configById.get(binding?.id)
      return {
        name: typeof binding?.name === 'string' ? binding.name : null,
        id: typeof binding?.id === 'string' ? binding.id : null,
        target: target ? `${target.domainId} ${target.database}` : 'UNKNOWN_RESOURCE',
      }
    })

  const d1BindingNames = bindings
    .filter((binding) => String(binding?.type ?? '').toLowerCase() === 'd1')
    .map((binding) => typeof binding?.name === 'string' ? binding.name : 'UNKNOWN_BINDING')

  return {
    worker: expected.worker,
    script: expected.script,
    status: 'AVAILABLE',
    hyperdriveBindings,
    d1BindingNames,
  }
}

export async function collectNeonHyperdriveInventory({
  accountId,
  apiToken,
  fetchImpl = fetch,
}) {
  accountId = required(accountId, 'CLOUDFLARE_ACCOUNT_ID')
  apiToken = required(apiToken, 'CLOUDFLARE_HYPERDRIVE_API_TOKEN')

  const configs = await listHyperdrives({ accountId, apiToken, fetchImpl })
  const hyperdrives = EXPECTED_HYPERDRIVES.map((expected) => inspectExpectedHyperdrive(configs, expected))
  const configById = new Map(
    configs
      .filter((config) => typeof config?.id === 'string')
      .map((config) => [config.id, EXPECTED_HYPERDRIVES.find((expected) => expected.name === config.name)])
      .filter((entry) => entry[1] !== undefined),
  )

  const workers = await Promise.all(WORKER_SCRIPTS.map((expected) =>
    inspectWorker({ accountId, apiToken, fetchImpl, expected, configById }),
  ))

  const matchCount = hyperdrives.filter((item) => item.matchesExpectedTarget).length
  const missingCount = hyperdrives.filter((item) => item.status === 'MISSING').length
  const mismatchCount = hyperdrives.filter((item) => ['MISMATCH', 'DUPLICATE_NAME'].includes(item.status)).length
  const unavailableWorkers = workers.filter((item) => ['UNAVAILABLE', 'INVALID_RESPONSE'].includes(item.status)).length
  const missingWorkers = workers.filter((item) => item.status === 'NOT_FOUND').length
  const boundWorkers = workers.filter((item) => item.hyperdriveBindings.length > 0).length

  return {
    schemaVersion: 1,
    inventoryType: 'cloudflare-neon-hyperdrive-live-read-only',
    readOnly: true,
    accountId,
    observedAt: new Date().toISOString(),
    summary: {
      expectedHyperdrives: EXPECTED_HYPERDRIVES.length,
      matchedHyperdrives: matchCount,
      missingHyperdrives: missingCount,
      mismatchedHyperdrives: mismatchCount,
      canonicalWorkerScripts: WORKER_SCRIPTS.length,
      availableWorkerSettings: workers.filter((item) => item.status === 'AVAILABLE').length,
      missingWorkerScripts: missingWorkers,
      unavailableWorkerSettings: unavailableWorkers,
      workersWithHyperdriveBindings: boundWorkers,
    },
    hyperdrives,
    workers,
  }
}

function toMarkdown(inventory) {
  const rows = inventory.hyperdrives.map((item) =>
    `| ${item.domainId} | ${item.database} | ${item.status} | ${item.id ?? '—'} |`,
  ).join('\n')
  const workerRows = inventory.workers.map((item) =>
    `| ${item.worker} | ${item.script} | ${item.status} | ${item.hyperdriveBindings.map((binding) => `${binding.name ?? '?'} → ${binding.target}`).join(', ') || '无'} | ${item.d1BindingNames.join(', ') || '无'} |`,
  ).join('\n')
  const s = inventory.summary
  return [
    '## Cloudflare Neon Hyperdrive 只读核验',
    '',
    `- Hyperdrive 目标匹配：**${s.matchedHyperdrives}/${s.expectedHyperdrives}**`,
    `- 缺失资源：**${s.missingHyperdrives}**；目标不匹配/重名：**${s.mismatchedHyperdrives}**`,
    `- Worker Settings 可读取：**${s.availableWorkerSettings}/${s.canonicalWorkerScripts}**；不存在脚本：**${s.missingWorkerScripts}**；读取异常：**${s.unavailableWorkerSettings}**`,
    '',
    '| 域 | 数据库 | 状态 | Hyperdrive ID |',
    '|---|---|---|---|',
    rows,
    '',
    '| Worker | 脚本 | Settings | Hyperdrive 绑定 | D1 绑定名 |',
    '|---|---|---|---|---|',
    workerRows,
    '',
    '> 本报告仅执行 Cloudflare GET 查询；不读取凭据内容，不创建/更新/删除资源，不修改 Worker 绑定，不部署。',
  ].join('\n')
}

async function main() {
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== 'refs/heads/main' ||
    process.env.CONFIRM_READ_ONLY !== 'VERIFY_NEON_HYPERDRIVE_LIVE_READONLY'
  ) {
    throw new Error('Live Cloudflare inventory is restricted to its confirmed workflow_dispatch on main')
  }

  const inventory = await collectNeonHyperdriveInventory({
    accountId: process.env.CF_ACCOUNT_ID,
    apiToken: process.env.CF_API_TOKEN,
  })
  await mkdir('artifacts', { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  const markdown = toMarkdown(inventory)
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`, 'utf8')
  }
  console.log(JSON.stringify(inventory, null, 2))
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Cloudflare read-only inventory failed')
    process.exitCode = 1
  })
}
