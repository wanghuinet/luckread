import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { getPayload } from 'payload'

const { default: config } = await import('../../src/neon-postgres-runtime.config.ts')
const marker = 'w01-pg-runtime-' + randomUUID()
const sourcePath = '/' + marker
const destinationUsername = marker + '-updated'
const destinationPath = '/' + destinationUsername
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

let payload
let createdId

try {
  payload = await getPayload({ config })

  const created = await payload.create({
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
  })
  createdId = created.id

  assert.ok(createdId !== undefined && createdId !== null, 'Payload create must return a redirect ID')

  await payload.update({
    collection: 'redirects',
    id: createdId,
    data: {
      to: { type: 'custom', url: destinationPath },
      destinationUsername,
    },
    depth: 0,
    overrideAccess: true,
  })

  const found = await payload.findByID({
    collection: 'redirects',
    id: createdId,
    depth: 0,
    overrideAccess: true,
  })

  assert.equal(found.from, sourcePath, 'Payload Local API must read the created redirect')
  assert.equal(found.destinationUsername, destinationUsername, 'Payload Local API must read the updated redirect')
  assert.equal(found.to?.url, destinationPath, 'Payload Local API must persist the updated redirect target')

  await payload.delete({
    collection: 'redirects',
    id: createdId,
    depth: 0,
    overrideAccess: true,
  })
  createdId = undefined

  const remaining = await payload.find({
    collection: 'redirects',
    where: { from: { equals: sourcePath } },
    depth: 0,
    limit: 1,
    pagination: false,
    overrideAccess: true,
  })
  assert.equal(remaining.docs.length, 0, 'Payload Local API delete must remove the runtime fixture')

  process.stdout.write('W01_PAYLOAD_POSTGRES_RUNTIME_PASS: Payload create/update/read/delete completed on local PostgreSQL 18; fixture count=0.\\n')
} catch (error) {
  process.stderr.write('W01_PAYLOAD_POSTGRES_RUNTIME_FAIL: ' + (error instanceof Error ? error.message : String(error)) + '\\n')
  process.exitCode = 1
} finally {
  if (payload && createdId !== undefined) {
    try {
      await payload.delete({
        collection: 'redirects',
        id: createdId,
        depth: 0,
        overrideAccess: true,
      })
    } catch {
      // Preserve the original failure. The workflow's postflight rejects residue.
    }
  }

  if (payload) {
    const database = payload.db
    if (typeof database.destroy === 'function') {
      await database.destroy()
    } else if (typeof database.drizzle?.$client?.end === 'function') {
      await database.drizzle.$client.end()
    }
  }
}
