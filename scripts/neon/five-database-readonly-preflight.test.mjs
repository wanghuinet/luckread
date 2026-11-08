import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DATABASE_TARGETS,
  summarizeTargetInspection,
  validateTargetConnectionString,
} from './five-database-readonly-preflight.mjs'

const target = DATABASE_TARGETS[0]
const validUrl = (database = target.database) =>
  'postgresql://readonly_user:secret@ep-example-pooler.ap-southeast-1.aws.neon.tech/' +
  database + '?sslmode=require&channel_binding=require'

const clean = (overrides = {}) => summarizeTargetInspection({
  target,
  actualDatabase: target.database,
  serverVersion: '18.6',
  serverVersionNum: 180006,
  tlsChainVerified: true,
  tlsHostnameVerified: true,
  schemas: ['public'],
  relations: [],
  customTypes: [],
  routines: [],
  otherObjects: [],
  extensions: [],
  globalObjects: [],
  ledgerPresent: false,
  ledgerRows: null,
  ...overrides,
})

test('declares exact five logical database targets and owner groups', () => {
  assert.deepEqual(DATABASE_TARGETS.map(({ domainId, database }) => [domainId, database]), [
    ['D1-01', 'luckread'],
    ['D1-02', 'luckreadpro'],
    ['D1-03', 'luckread_governance'],
    ['D1-04', 'luckread_finance'],
    ['D1-05', 'allluck'],
  ])
})

test('accepts a PostgreSQL Neon target with TLS and channel binding required', () => {
  const result = validateTargetConnectionString(validUrl(), target.database)
  assert.equal(result.valid, true)
  assert.equal(result.parsed.hostname, 'ep-example-pooler.ap-southeast-1.aws.neon.tech')
})

test('rejects a connection URL that points to the wrong logical database', () => {
  assert.deepEqual(
    validateTargetConnectionString(validUrl('luckreadpro'), target.database),
    { valid: false, code: 'DATABASE_URL_TARGET_MISMATCH' },
  )
})

test('rejects non-Neon hosts, non-PostgreSQL protocols and missing channel binding', () => {
  assert.equal(
    validateTargetConnectionString(
      'postgresql://u:p@db.example.com/luckread?sslmode=require&channel_binding=require',
      'luckread',
    ).code,
    'UNAPPROVED_DATABASE_HOST',
  )
  assert.equal(
    validateTargetConnectionString(
      'https://u:p@ep-example.neon.tech/luckread?sslmode=require&channel_binding=require',
      'luckread',
    ).code,
    'INVALID_POSTGRES_PROTOCOL',
  )
  assert.equal(
    validateTargetConnectionString(
      'postgresql://u:p@ep-example.neon.tech/luckread?sslmode=require',
      'luckread',
    ).code,
    'CHANNEL_BINDING_REQUIRED',
  )
})

test('passes only an empty PostgreSQL 18 catalog with absent migration ledger', () => {
  const result = clean()
  assert.equal(result.status, 'PASS_EMPTY')
  assert.deepEqual(result.issues, [])
  assert.deepEqual(result.migrationLedger, {
    present: false,
    rows: null,
    expectedState: 'ABSENT_BEFORE_SCHEMA_INITIALIZATION',
  })
})

test('blocks a pre-existing ledger even when it contains zero rows', () => {
  const result = clean({ ledgerPresent: true, ledgerRows: 0 })
  assert.equal(result.status, 'BLOCKED_NOT_EMPTY')
  assert.ok(result.issues.includes('MIGRATION_LEDGER_ALREADY_EXISTS'))
})

test('blocks any user relations, extra schema or non-default extension', () => {
  const result = clean({
    schemas: ['public', 'app'],
    relations: ['public.users:r'],
    extensions: ['postgis'],
  })
  assert.equal(result.status, 'BLOCKED_NOT_EMPTY')
  assert.ok(result.issues.includes('UNEXPECTED_SCHEMAS'))
  assert.ok(result.issues.includes('UNEXPECTED_RELATIONS'))
  assert.ok(result.issues.includes('UNEXPECTED_EXTENSIONS'))
})

test('fails closed for a wrong PostgreSQL major or an unverified TLS endpoint', () => {
  assert.equal(clean({ serverVersion: '17.9', serverVersionNum: 170009 }).status, 'FAIL')
  assert.equal(clean({ tlsHostnameVerified: false }).status, 'FAIL')
  assert.equal(clean({ tlsChainVerified: false }).status, 'FAIL')
})
