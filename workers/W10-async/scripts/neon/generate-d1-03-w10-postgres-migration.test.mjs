import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildD103W10Migration } from './generate-d1-03-w10-postgres-migration.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const read = (relativePath) => {
  try {
    return readFileSync(path.join(root, relativePath), 'utf8')
  } catch {
    return null
  }
}

test('W10 PostgreSQL migration is deterministic and bound to six owner entities', () => {
  const result = buildD103W10Migration({ readSource: read })
  assert.equal(result.migration, read('workers/W10-async/src/neon-postgres-migrations/0001_w10_d1_03_async_execution.sql'))
  assert.deepEqual(Object.keys(result.contract.schema.tables), [
    'jobs',
    'job_retries',
    'execution_dead_letters',
    'execution_inbox',
    'execution_outbox',
    'operational_idempotency',
  ])
  assert.equal(result.contract.schema.totals.tables, 6)
  assert.equal(result.contract.schema.totals.explicitIndexes, 7)
  assert.equal(result.contract.schema.totals.foreignKeys, 2)
})

test('W10 source cannot proceed if an entity is removed from the frozen owner boundary', () => {
  assert.throws(
    () => buildD103W10Migration({
      readSource: (relativePath) => {
        const value = read(relativePath)
        if (relativePath === 'contracts/transport/d1-03-entity-owner-boundary.v1.json') {
          const parsed = JSON.parse(value)
          parsed.owners.W10 = parsed.owners.W10.slice(0, -1)
          return JSON.stringify(parsed)
        }
        return value
      },
    }),
    /six-entity primary-owner inventory/,
  )
})

test('W10 source cannot take migration ownership away from W09', () => {
  assert.throws(
    () => buildD103W10Migration({
      readSource: (relativePath) => {
        const value = read(relativePath)
        if (relativePath === 'workers/W09-platform/wrangler.d1-03-migrations.jsonc') {
          return JSON.stringify({ name: 'luckread-w10', d1_databases: [] })
        }
        return value
      },
    }),
    /W09 must remain the sole D1-03/,
  )
})

test('schema-only admission does not add a W10 D1 or Queue binding', () => {
  assert.throws(
    () => buildD103W10Migration({
      readSource: (relativePath) => {
        const value = read(relativePath)
        if (relativePath === 'workers/W10-async/wrangler.jsonc') {
          const parsed = JSON.parse(value)
          parsed.d1_databases = [{ binding: 'D1_03' }]
          return JSON.stringify(parsed)
        }
        return value
      },
    }),
    /must not add W10 D1\/Queue bindings/,
  )
})

test('W10 D1 source cannot drift into another owner or raw payload persistence', () => {
  assert.throws(
    () => buildD103W10Migration({
      readSource: (relativePath) => {
        const value = read(relativePath)
        if (relativePath === 'workers/W09-platform/migrations-d1-03/0002_w10_async_execution_state.sql') {
          return value + '\nCREATE TABLE IF NOT EXISTS audit_events (event_id TEXT);\n'
        }
        return value
      },
    }),
    /must define exactly the six admitted execution tables/,
  )
})
