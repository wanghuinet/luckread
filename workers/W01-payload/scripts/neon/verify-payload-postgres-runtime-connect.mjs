import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Payload 3.94.1 contains the upstream PostgreSQL pool-client release fix.
// Verify the published adapter instead of mutating node_modules during CI.
const entryPath = fileURLToPath(import.meta.resolve('@payloadcms/db-postgres'))
const packageRoot = path.resolve(path.dirname(entryPath), '..')
const packageJSON = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))

assert.equal(packageJSON.version, '3.94.1', 'Review this verifier when changing the pinned Payload Postgres adapter version')

const connectPath = path.join(packageRoot, 'dist', 'connect.js')
const source = await readFile(connectPath, 'utf8')
const listenerStart = source.indexOf('result.prependListener(')
const releaseIndex = source.indexOf('result.release()', listenerStart)

assert.notEqual(listenerStart, -1, 'Expected the Payload Postgres bootstrap error listener in connect.js')
assert.notEqual(releaseIndex, -1, 'Expected Payload to release the bootstrap pool client after attaching the listener')
assert.ok(releaseIndex > listenerStart, 'Pool client must be released after the bootstrap listener is attached')

process.stdout.write('W01_PG_RUNTIME_POOL_RELEASE_UPSTREAM_FIX_VERIFIED: Payload db-postgres 3.94.1\n')
