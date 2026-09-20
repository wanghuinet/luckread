import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const requireFromW01 = createRequire(new URL('../workers/W01-payload/package.json', import.meta.url))
const { getPayload } = requireFromW01('payload')

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runId = Number(process.env.GITHUB_RUN_ID || 0)
if (!runId) throw new Error('GITHUB_RUN_ID is required')

process.env.NODE_ENV = 'production'
process.env.CLOUDFLARE_ENV = 'production'
process.env.PAYLOAD_MIGRATION_REMOTE = 'true'
process.env.PAYLOAD_SECRET = 'ignore'

const outDir = resolve(repositoryRoot, 'artifacts/evidence/auth-002/adapter-regression')
mkdirSync(outDir, { recursive: true })

const key = `w01-e45-${runId}`
const data = {
  key,
  value: { probe: key, sequence: 1 },
}
const where = { key: { equals: key } }
const stageFile = `${outDir}/probe-stage.json`

const result = {
  version: '1.0.0',
  evidenceType: 'AUTH_002_E4_5_D1_ADAPTER_REGRESSION',
  repository: 'wanghuinet/luckread',
  workerPath: 'workers/W01-payload',
  runId,
  testedCommitSha: process.env.GITHUB_SHA || '',
  payloadVersion: '3.87.1',
  d1AdapterVersion: '3.87.1',
  environmentClass: 'CONTROLLED_REMOTE_D1',
  databaseName: 'luckread',
  probeKey: key,
  operation: 'payload.db.upsert(payload-preferences)',
  expected: 'missing preference row is inserted and can be read back',
  observed: null,
  persistedAfterUpsert: false,
  cleanedUp: false,
  adapterUpsertAliasesUpdateOne: null,
  error: null,
}

const writeStage = (stage, extra = {}) => {
  writeFileSync(
    stageFile,
    JSON.stringify(
      {
        version: '1.0.0',
        runId,
        testedCommitSha: process.env.GITHUB_SHA || '',
        stage,
        timestamp: new Date().toISOString(),
        ...extra,
      },
      null,
      2,
    ) + '\\n',
  )
}

const withTimeout = async (label, promise, timeoutMs = 60_000) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

let payload
writeStage('START')
try {
  writeStage('IMPORT_PAYLOAD_CONFIG')
  const { default: config } = await import('../workers/W01-payload/src/payload.config.ts')

  writeStage('GET_PAYLOAD_START')
  payload = await withTimeout('getPayload', getPayload({ config, key: `e45-${runId}` }))
  writeStage('GET_PAYLOAD_DONE')

  result.adapterUpsertAliasesUpdateOne = payload.db.upsert === payload.db.updateOne

  writeStage('UPSERT_START', {
    adapterUpsertAliasesUpdateOne: result.adapterUpsertAliasesUpdateOne,
  })
  let upsertError = null
  let upsertResult = null
  try {
    upsertResult = await withTimeout(
      'payload.db.upsert(payload-preferences)',
      payload.db.upsert({
        collection: 'payload-preferences',
        data,
        where,
      }),
    )
  } catch (error) {
    upsertError = error instanceof Error ? error.message : String(error)
  }
  writeStage('UPSERT_DONE', { upsertError })

  writeStage('FIND_ONE_START')
  const stored = await withTimeout(
    'payload.db.findOne(payload-preferences)',
    payload.db.findOne({
      collection: 'payload-preferences',
      where,
    }),
  )
  writeStage('FIND_ONE_DONE', { storedRowPresent: Boolean(stored) })

  result.observed = {
    upsertReturnedDocument: Boolean(upsertResult),
    upsertError: upsertError ? String(upsertError).slice(0, 300) : null,
    storedRowPresent: Boolean(stored),
    storedValueMatches: Boolean(
      stored && JSON.stringify(stored.value) === JSON.stringify(data.value),
    ),
  }
  result.persistedAfterUpsert = Boolean(
    stored && JSON.stringify(stored.value) === JSON.stringify(data.value),
  )

  writeStage('CLEANUP_START')
  try {
    await withTimeout(
      'payload.db.deleteMany(payload-preferences)',
      payload.db.deleteMany({
        collection: 'payload-preferences',
        where,
      }),
    )
    const afterCleanup = await withTimeout(
      'payload.db.findOne(payload-preferences) cleanup check',
      payload.db.findOne({
        collection: 'payload-preferences',
        where,
      }),
    )
    result.cleanedUp = !afterCleanup
    writeStage('CLEANUP_DONE', { cleanedUp: result.cleanedUp })
  } catch (error) {
    result.error = `cleanup preference: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
    writeStage('CLEANUP_ERROR', { error: result.error })
  }
} catch (error) {
  result.error = `setup: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
  writeStage('ERROR', { error: result.error })
}

writeFileSync(
  `${outDir}/adapter-regression.json`,
  JSON.stringify(result, null, 2) + '\\n',
)

console.log(JSON.stringify(result, null, 2))

if (result.error) process.exit(1)
if (!result.persistedAfterUpsert) process.exit(1)
if (!result.cleanedUp) process.exit(1)
