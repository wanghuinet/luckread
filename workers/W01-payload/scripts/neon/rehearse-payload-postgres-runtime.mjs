import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { getPayload } from 'payload'

const databaseUrl = process.env.PAYLOAD_SCHEMA_DATABASE_URL
if (!databaseUrl) throw new Error('PAYLOAD_SCHEMA_DATABASE_URL is required')
const target = new URL(databaseUrl)
if (
  !['127.0.0.1', 'localhost', 'postgres'].includes(target.hostname) ||
  target.port !== '5432' ||
  target.pathname !== '/luckread_schema'
) {
  throw new Error('Refusing to run the Payload Local API rehearsal outside local PostgreSQL luckread_schema')
}

const { default: config } = await import('../../src/neon-postgres-runtime.config.ts')
const marker = 'w01-pg-runtime-' + randomUUID()
const sourcePath = '/' + marker
const destinationUsername = marker + '-updated'
const destinationPath = '/' + destinationUsername
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

let payload

async function step(name, operation, timeoutMs = 45_000) {
  process.stdout.write('W01_PG_RUNTIME_STEP_START ' + name + '\\n')
  let timeout
  try {
    const value = await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('W01_PG_RUNTIME_STEP_TIMEOUT ' + name)), timeoutMs)
      }),
    ])
    process.stdout.write('W01_PG_RUNTIME_STEP_PASS ' + name + '\\n')
    return value
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

try {
  payload = await step('GET_PAYLOAD', () => getPayload({ config, disableOnInit: true }))

  const created = await step('CREATE_REDIRECT', () => payload.create({
    collection: 'redirects',
    data: {
      from: sourcePath,
      to: { type: 'custom', url: destinationPath },
      type: '301',
      redirectScope: 'username',
      identityId: marker,
      sourceUsername: marker,
      destinationUsername: marker,
      expiresAt,
    },
    depth: 0,
    overrideAccess: true,
  }))
  const createdId = created.id

  assert.ok(createdId !== undefined && createdId !== null, 'Payload create must return a redirect ID')

  await step('UPDATE_REDIRECT', () => payload.update({
    collection: 'redirects',
    id: createdId,
    data: {
      to: { type: 'custom', url: destinationPath },
      destinationUsername,
    },
    depth: 0,
    overrideAccess: true,
  }))

  const found = await step('READ_REDIRECT', () => payload.findByID({
    collection: 'redirects',
    id: createdId,
    depth: 0,
    overrideAccess: true,
  }))

  assert.equal(found.from, sourcePath, 'Payload Local API must read the created redirect')
  assert.equal(found.destinationUsername, destinationUsername, 'Payload Local API must read the updated redirect')
  assert.equal(found.to?.url, destinationPath, 'Payload Local API must persist the updated redirect target')

  await step('DELETE_REDIRECT', () => payload.delete({
    collection: 'redirects',
    id: createdId,
    depth: 0,
    overrideAccess: true,
  }))

  const remaining = await step('VERIFY_REDIRECT_ABSENT', () => payload.find({
    collection: 'redirects',
    where: { from: { equals: sourcePath } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  }))
  assert.equal(remaining.docs.length, 0, 'Payload Local API delete must remove the runtime fixture')

  process.stdout.write('W01_PAYLOAD_POSTGRES_RUNTIME_PASS: Payload create/update/read/delete completed on local PostgreSQL 18; fixture count=0.\\n')
} catch (error) {
  process.stderr.write('W01_PAYLOAD_POSTGRES_RUNTIME_FAIL: ' + (error instanceof Error ? error.message : String(error)) + '\\n')
  process.exitCode = 1
} finally {
  if (payload) {
    try {
      await step('CLEANUP_MARKED_REDIRECTS', async () => {
        const leftovers = await payload.find({
          collection: 'redirects',
          where: { from: { equals: sourcePath } },
          depth: 0,
          limit: 10,
          pagination: false,
          overrideAccess: true,
        })
        for (const document of leftovers.docs) {
          await payload.delete({
            collection: 'redirects',
            id: document.id,
            depth: 0,
            overrideAccess: true,
          })
        }
      }, 15_000)
    } catch (cleanupError) {
      process.stderr.write('W01_PG_RUNTIME_CLEANUP_FAILED: ' + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) + '\\n')
      process.exitCode = 1
    }

    const database = payload.db
    if (typeof database.destroy === 'function') {
      await database.destroy()
    } else if (typeof database.drizzle?.$client?.end === 'function') {
      await database.drizzle.$client.end()
    }
  }
}
