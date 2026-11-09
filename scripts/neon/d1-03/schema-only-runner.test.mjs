import test from 'node:test'
import assert from 'node:assert/strict'
import {
  enforceD103VerifiedNeonConnectionString,
  validateD103RemoteApplyContext,
  validateD103RemoteNeonTarget,
  verifyD103RemoteTlsConnection,
} from './remote-schema-runner.mjs'
import { parseCommandLine as parseSharedCommandLine } from '../shared-domain-schema-runner.mjs'
import { parseCommandLine } from './schema-only-runner.mjs'
import { assertD103RemoteApplyBlocked } from './assert-remote-apply-release.mjs'

const host = 'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech'
const rawUrl = (tail = '') =>
  'postgresql://neondb_owner:local-test-only@' + host +
  '/luckread_governance?sslmode=require&channel_binding=require' + tail

test('D1-03 remote target accepts only the exact governance Neon host/database after TLS hardening', () => {
  const hardened = enforceD103VerifiedNeonConnectionString(rawUrl())
  const target = validateD103RemoteNeonTarget(hardened)
  assert.equal(target.valid, true)
  assert.equal(target.parsed.hostname, host)
  assert.equal(target.parsed.pathname, '/luckread_governance')
  assert.equal(target.parsed.searchParams.get('sslmode'), 'verify-full')
  assert.equal(target.parsed.searchParams.get('channel_binding'), 'require')
})

test('D1-03 remote target rejects wrong host/database, missing credentials and unsafe TLS parameters', () => {
  assert.equal(validateD103RemoteNeonTarget('').valid, false)
  assert.equal(validateD103RemoteNeonTarget(rawUrl().replace(host, 'evil.example')).valid, false)
  assert.equal(validateD103RemoteNeonTarget(rawUrl().replace('/luckread_governance?', '/luckreadpro?')).valid, false)
  assert.equal(validateD103RemoteNeonTarget(rawUrl().replace('sslmode=require', 'sslmode=disable')).valid, false)
  assert.equal(validateD103RemoteNeonTarget(rawUrl() + '&sslmode=verify-full').valid, false)
  assert.equal(validateD103RemoteNeonTarget(rawUrl().replace('neondb_owner:local-test-only@', '@')).valid, false)
})

test('D1-03 remote apply requires GitHub Actions, exact main ref and exact partial-scope confirmation', () => {
  assert.deepEqual(validateD103RemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE_PARTIAL',
  }), { valid: true, errors: [] })
  assert.equal(validateD103RemoteApplyContext({
    githubActions: 'false',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE_PARTIAL',
  }).valid, false)
  assert.equal(validateD103RemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/feature',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE_PARTIAL',
  }).valid, false)
  assert.equal(validateD103RemoteApplyContext({
    githubActions: 'true',
    githubRef: 'refs/heads/main',
    confirmation: 'APPLY_REVIEWED_SCHEMA_D1_03_GOVERNANCE',
  }).valid, false)
})

test('remote PostgreSQL connection fails closed without a verified TLS peer certificate', () => {
  assert.throws(
    () => verifyD103RemoteTlsConnection({ connection: { stream: {} } }),
    /TLS certificate chain or hostname verification failed/,
  )
  assert.throws(
    () => verifyD103RemoteTlsConnection({}),
    /TLS certificate chain or hostname verification failed/,
  )
})

test('remote wrapper CLI accepts only the explicit remote entry point', () => {
  assert.deepEqual(parseCommandLine(['--remote-neon']), { valid: true, mode: 'REMOTE_NEON' })
  assert.equal(parseCommandLine(['--local-only']).valid, false)
  assert.equal(parseCommandLine([]).valid, false)
  assert.equal(parseCommandLine(['--remote-neon', '--local-only']).valid, false)
})

test('general shared executor remains local-only for every domain', () => {
  assert.equal(parseSharedCommandLine(['--domain', 'D1-03', '--remote-neon']).valid, false)
  assert.deepEqual(parseSharedCommandLine(['--domain', 'D1-03', '--local-only']), {
    valid: true,
    domainId: 'D1-03',
  })
})

test('the first implementation slice keeps remote D1-03 release blocked pending source-pinned review', () => {
  const result = assertD103RemoteApplyBlocked()
  assert.deepEqual(result, {
    blocked: true,
    partialRemoteApplyReady: false,
    remoteNeonDdlExecuted: false,
  })
})
