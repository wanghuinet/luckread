#!/usr/bin/env node
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const expected = [
  'luck01-identity',
  'luck02-content',
  'luck03-social',
  'luck04-commerce',
  'luck05-creator',
  'luck06-async',
]

const workersRoot = join(process.cwd(), 'workers')
const actual = readdirSync(workersRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== 'old1.0')
  .map((entry) => entry.name)
  .sort()

const expectedSorted = [...expected].sort()
const same = actual.length === expectedSorted.length &&
  actual.every((name, index) => name === expectedSorted[index])

if (!same) {
  const missing = expectedSorted.filter((name) => !actual.includes(name))
  const unexpected = actual.filter((name) => !expectedSorted.includes(name))
  console.error('WORKER_DIRECTORY_DRIFT=FAIL')
  console.error(JSON.stringify({ expected: expectedSorted, actual, missing, unexpected }, null, 2))
  process.exit(1)
}

for (const name of expectedSorted) {
  const path = join(workersRoot, name)
  if (!statSync(path).isDirectory()) {
    console.error(`WORKER_DIRECTORY_TYPE=FAIL ${name}`)
    process.exit(1)
  }
}

console.log('WORKER_DIRECTORY_DRIFT=PASS')
console.log(JSON.stringify({ count: actual.length, workers: actual }, null, 2))
