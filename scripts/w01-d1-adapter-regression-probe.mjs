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
const syntheticUserEmail = `e45-${runId}@example.invalid`

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
  syntheticUserId: null,
  operation: 'payload.db.upsert(payload-preferences)',
  expected: 'missing preference row is inserted and can be read back',
  observed: null,
  persistedAfterUpsert: false,
  cleanedUp: false,
  adapterUpsertAliasesUpdateOne: null,
  error: null,
}

let payload
let createdUserId = null
let where
let data
try {
  const { default: config } = await import('../workers/W01-payload/src/payload.config.ts')
  payload = await getPayload({ config, key: `e45-${runId}` })

  result.adapterUpsertAliasesUpdateOne = payload.db.upsert === payload.db.updateOne

  const createdUser = await payload.db.create({
    collection: 'users',
    data: { email: syntheticUserEmail },
  })
  createdUserId = createdUser.id
  result.syntheticUserId = createdUserId

  where = {
    and: [
      { key: { equals: key } },
      { 'user.value': { equals: createdUserId } },
      { 'user.relationTo': { equals: 'users' } },
    ],
  }
  data = {
    key,
    user: { relationTo: 'users', value: createdUserId },
    value: { probe: key, sequence: 1 },
  }

  let upsertError = null
  let upsertResult = null
  try {
    upsertResult = await payload.db.upsert({ collection: 'payload-preferences', data, where })
  } catch (error) {
    upsertError = error instanceof Error ? error.message : String(error)
  }

  const stored = await payload.db.findOne({
    collection: 'payload-preferences',
    where,
  })

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

  try {
    await payload.db.deleteMany({
      collection: 'payload-preferences',
      where,
    })
    const afterCleanup = await payload.db.findOne({
      collection: 'payload-preferences',
      where,
    })
    result.cleanedUp = !afterCleanup
  } catch (error) {
    result.error = `cleanup preference: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
  }
} catch (error) {
  result.error = `setup: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
} finally {
  if (payload && createdUserId !== null) {
    try {
      await payload.db.deleteOne({ collection: 'users', id: createdUserId })
      const afterUserCleanup = await payload.db.findOne({
        collection: 'users',
        where: { id: { equals: createdUserId } },
      })
      if (afterUserCleanup) {
        result.cleanedUp = false
        result.error = result.error || 'cleanup user: synthetic user still exists'
      }
    } catch (error) {
      result.cleanedUp = false
      result.error = result.error || `cleanup user: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300)
    }
  }
}

writeFileSync(
  `${outDir}/adapter-regression.json`,
  JSON.stringify(result, null, 2) + '\n',
)

console.log(JSON.stringify(result, null, 2))

if (result.error) process.exit(1)
if (!result.persistedAfterUpsert) process.exit(1)
if (!result.cleanedUp) process.exit(1)
