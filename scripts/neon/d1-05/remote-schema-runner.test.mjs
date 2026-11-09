import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DOMAIN_MANIFESTS, buildDomainPlan } from '../shared-domain-schema-runner.mjs'
import {
  parseCommandLine,
  validateD105RemoteApplyContext,
  validateD105RemoteNeonTarget,
  enforceD105VerifiedNeonConnectionString,
} from './remote-schema-runner.mjs'
import {
  assertD105RemoteApplyBlocked,
  validateD105SchemaOnlyReleaseState,
} from './assert-remote-apply-release.mjs'

const manifest = JSON.parse(readFileSync(DOMAIN_MANIFESTS['D1-05'], 'utf8'))
const review = JSON.parse(readFileSync('contracts/database/neon-d1-05-remote-runner-review.v1.json', 'utf8'))
const validUrl = 'postgresql://neondb_owner:local_test_password@ep-test-pooler.c-3.ap-southeast-1.aws.neon.tech/allluck?sslmode=verify-full&channel_binding=require'

test('D1-05 runner exposes exactly one explicit execution mode', () => {
  assert.deepEqual(parseCommandLine(['--local-only']), { valid: true, mode: 'LOCAL_ONLY' })
  assert.deepEqual(parseCommandLine(['--remote-neon']), { valid: true, mode: 'REMOTE_NEON' })
  assert.equal(parseCommandLine([]).valid, false)
  assert.equal(parseCommandLine(['--remote-neon', '--local-only']).valid, false)
  assert.equal(parseCommandLine(['--domain', 'D1-05', '--remote-neon']).valid, false)
})

test('D1-05 remote target requires the exact database, Neon endpoint and full TLS parameters', () => {
  assert.equal(validateD105RemoteNeonTarget(validUrl).valid, true)
  assert.equal(validateD105RemoteNeonTarget(validUrl.replace('/allluck?', '/luckread?')).valid, false)
  assert.equal(validateD105RemoteNeonTarget(validUrl.replace('sslmode=verify-full', 'sslmode=require')).valid, false)
  assert.equal(validateD105RemoteNeonTarget(validUrl.replace('&channel_binding=require', '')).valid, false)
  assert.equal(validateD105RemoteNeonTarget(validUrl.replace('ep-test-pooler.c-3.ap-southeast-1.aws.neon.tech', 'localhost')).valid, false)
  assert.equal(validateD105RemoteNeonTarget('not-a-url').valid, false)
})

test('connection hardening always requires verify-full TLS and channel binding', () => {
  const hardened = new URL(enforceD105VerifiedNeonConnectionString(
    validUrl.replace('sslmode=verify-full', 'sslmode=require'),
  ))
  assert.equal(hardened.searchParams.get('sslmode'), 'verify-full')
  assert.equal(hardened.searchParams.get('channel_binding'), 'require')
})

test('remote apply requires Actions, exact main ref and exact confirmation', () => {
  const valid = validateD105RemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_05_ALLLUCK_SCHEMA_ONLY',
  })
  assert.equal(valid.valid, true)
  assert.equal(validateD105RemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/feature',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_05_ALLLUCK_SCHEMA_ONLY',
  }).valid, false)
  assert.equal(validateD105RemoteApplyContext({
    githubActions: 'false',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_05_ALLLUCK_SCHEMA_ONLY',
  }).valid, false)
  assert.equal(validateD105RemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_ALL',
  }).valid, false)
})

test('W11 D1-05 manifest remains exactly one admitted six-table schema slice', () => {
  const plan = buildDomainPlan(manifest)
  assert.equal(manifest.domainId, 'D1-05')
  assert.equal(manifest.databaseName, 'allluck')
  assert.equal(manifest.remoteApplyReady, false)
  assert.equal(manifest.entries.length, 1)
  assert.equal(plan.entries.length, 1)
  assert.equal(plan.tables.length, 6)
  assert.equal(plan.indexes.length, 8)
  assert.equal(plan.triggers.length, 0)
  assert.equal(plan.functions.length, 0)
  assert.equal(manifest.expected.foreignKeys, 0)
  assert.equal(manifest.expected.businessRows, 0)
  assert.equal(manifest.expected.controlSeedRows, 0)
})

test('schema-only release keeps runtime privacy blockers and is not implicitly approved', () => {
  assert.equal(validateD105SchemaOnlyReleaseState({ manifest, review }), false)
  assert.deepEqual(assertD105RemoteApplyBlocked(), {
    blocked: true,
    schemaOnlyRemoteApplyReady: false,
    runtimeDataIngestionEnabled: false,
    remoteNeonDdlExecuted: false,
  })
})
