import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Payload's upstream pool-client release fix landed on main (4.x) but is not
// present in the 3.90.2 package used by this W01 rehearsal. Apply the same
// one-line fix only to this disposable CI installation; never change the
// repository's production D1 runtime or committed dependency artifacts.
const entryPath = fileURLToPath(import.meta.resolve('@payloadcms/db-postgres'))
const packageRoot = path.resolve(path.dirname(entryPath), '..')
const packageJSON = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'))

assert.equal(
  packageJSON.version,
  '3.90.2',
  'Review this compatibility patch before changing the pinned Payload Postgres adapter version',
)

const connectPath = path.join(packageRoot, 'dist', 'connect.js')
const source = await readFile(connectPath, 'utf8')
const listenerStart = source.indexOf('result.prependListener(')

assert.notEqual(listenerStart, -1, 'Expected the Payload Postgres bootstrap listener in connect.js')

const arrow = source.indexOf('=>', listenerStart)
const openingBrace = source.indexOf('{', arrow)
assert.notEqual(arrow, -1, 'Expected the bootstrap error-listener callback')
assert.notEqual(openingBrace, -1, 'Expected the bootstrap error-listener callback body')

let depth = 0
let closingBrace = -1
for (let index = openingBrace; index < source.length; index += 1) {
  if (source[index] === '{') depth += 1
  if (source[index] === '}') depth -= 1
  if (depth === 0) {
    closingBrace = index
    break
  }
}

assert.notEqual(closingBrace, -1, 'Could not locate the end of the bootstrap error listener')

let statementEnd = closingBrace + 1
while (/\s/.test(source[statementEnd] ?? '')) statementEnd += 1
assert.equal(source.slice(statementEnd, statementEnd + 2), ');', 'Unexpected Payload connect.js listener shape')

const alreadyReleased = source.slice(statementEnd + 2, statementEnd + 160).includes('result.release()')
if (alreadyReleased) {
  process.stdout.write('W01_PG_RUNTIME_POOL_RELEASE_PATCH_ALREADY_PRESENT\n')
} else {
  const patched =
    source.slice(0, statementEnd + 2) +
    '\n  result.release()' +
    source.slice(statementEnd + 2)
  await writeFile(connectPath, patched)
  process.stdout.write('W01_PG_RUNTIME_POOL_RELEASE_PATCH_APPLIED: Payload db-postgres 3.90.2 CI-only install\n')
}
