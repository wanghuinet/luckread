import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload } from 'payload'

import config from '../../src/neon-postgres-runtime-test.config.js'

const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL
if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')

const parsedDatabaseUrl = new URL(databaseUrl)
const localRuntimeTarget =
  new Set(['127.0.0.1', 'localhost', 'postgres']).has(parsedDatabaseUrl.hostname) &&
  parsedDatabaseUrl.port === '5432' &&
  parsedDatabaseUrl.pathname === '/luckread_schema'
if (!localRuntimeTarget) {
  throw new Error('Refusing to run Payload CRUD against anything except local luckread_schema')
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(scriptDir, '../..')
const reportPath = path.join(packageRoot, 'artifacts/neon/w01-payload-runtime-rehearsal.json')
const payload = await getPayload({ config })
let createdId: string | number | undefined
let deleted = false

try {
  assert.equal(
    payload.db.packageName,
    '@payloadcms/db-postgres',
    'W01 runtime rehearsal must use the official Payload PostgreSQL adapter',
  )

  const nonce = randomUUID().replaceAll('-', '').slice(0, 16).toLowerCase()
  const email = `pg-${nonce}@example.test`
  const username = `pgtest${nonce}`
  const identityId = randomUUID()

  const created = await payload.create({
    collection: 'users',
    data: {
      email,
      username,
      identityId,
      displayName: 'PostgreSQL runtime rehearsal',
    },
    depth: 0,
    overrideAccess: true,
  })
  createdId = created.id as string | number

  assert.ok(createdId !== undefined && createdId !== null, 'Payload create must return an ID')
  assert.equal(created.email, email)
  assert.equal(created.username, username)
  assert.equal(created.identityId, identityId)

  const readBack = await payload.findByID({
    collection: 'users',
    id: createdId,
    depth: 0,
    overrideAccess: true,
  })
  assert.equal(readBack.email, email, 'Payload Local API read must return the inserted user')
  assert.equal(readBack.username, username)

  const updated = await payload.update({
    collection: 'users',
    id: createdId,
    data: { displayName: 'PostgreSQL runtime update verified' },
    depth: 0,
    overrideAccess: true,
  })
  assert.equal(updated.displayName, 'PostgreSQL runtime update verified')

  await payload.delete({
    collection: 'users',
    id: createdId,
    overrideAccess: true,
  })
  deleted = true

  const remaining = await payload.find({
    collection: 'users',
    where: { id: { equals: createdId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  assert.equal(remaining.totalDocs, 0, 'Payload Local API delete must remove the test row')

  const report = {
    reportVersion: 1,
    status: 'W01_PAYLOAD_POSTGRES_RUNTIME_REHEARSAL_PASS',
    scope: 'Disposable PostgreSQL 18 only; Payload Local API CRUD through the official PostgreSQL adapter.',
    target: { host: parsedDatabaseUrl.hostname, database: parsedDatabaseUrl.pathname.slice(1) },
    adapterPackage: payload.db.packageName,
    operationsVerified: ['CREATE', 'READ_BY_ID', 'UPDATE', 'DELETE', 'VERIFY_DELETED'],
    testBusinessRowsRemaining: 0,
    productionAuthorityChanged: false,
    neonConnectionAttempted: false,
    cloudflareD1Touched: false,
    workerBindingsChanged: false,
    r2Accessed: false,
  }

  mkdirSync(path.dirname(reportPath), { recursive: true })
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} finally {
  if (createdId !== undefined && !deleted) {
    await payload.delete({
      collection: 'users',
      id: createdId,
      overrideAccess: true,
    }).catch((): undefined => undefined)
  }
  await payload.destroy()
}
