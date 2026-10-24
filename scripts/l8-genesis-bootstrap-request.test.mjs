import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateL8GenesisBootstrapRequest } from './l8-genesis-bootstrap-request.mjs'

const NOW = new Date('2026-10-24T12:00:00.000Z')
const validRequest = () => ({
  version: 1,
  operation: 'INITIAL_L8_BOOTSTRAP',
  targetUserId: 'user-12345678',
  roleId: 'super_admin',
  scopeType: 'global',
  scopeId: null,
  reason: 'Initialize the first privileged LuckRead operator account.',
  nonce: 'a'.repeat(64),
  createdAt: '2026-10-24T11:59:00.000Z',
  expiresAt: '2026-10-24T15:59:00.000Z',
})

describe('L8 genesis request static preflight', () => {
  it('accepts only a valid, non-expired, four-hour-bounded request', () => {
    assert.deepEqual(validateL8GenesisBootstrapRequest(validRequest(), NOW), {
      valid: true,
      reason: null,
    })
  })

  it('fails closed for a missing or non-object request', () => {
    assert.equal(validateL8GenesisBootstrapRequest(undefined, NOW).valid, false)
    assert.equal(validateL8GenesisBootstrapRequest([], NOW).valid, false)
  })

  it('rejects the wrong target role, scope, malformed target, or missing nonce', () => {
    for (const patch of [
      { roleId: 'admin' },
      { scopeType: 'organization' },
      { targetUserId: 'short' },
      { nonce: 'not-a-nonce' },
    ]) {
      assert.equal(validateL8GenesisBootstrapRequest({ ...validRequest(), ...patch }, NOW).valid, false)
    }
  })

  it('rejects an expired or future-dated request', () => {
    assert.equal(validateL8GenesisBootstrapRequest({
      ...validRequest(),
      createdAt: '2026-10-24T11:58:00.000Z',
      expiresAt: '2026-10-24T11:59:00.000Z',
    }, NOW).reason, 'REQUEST_EXPIRED')
    assert.equal(validateL8GenesisBootstrapRequest({
      ...validRequest(),
      createdAt: '2026-10-24T12:00:01.000Z',
    }, NOW).reason, 'REQUEST_NOT_YET_VALID')
  })

  it('rejects a request lifetime longer than four hours', () => {
    assert.equal(validateL8GenesisBootstrapRequest({
      ...validRequest(),
      expiresAt: '2026-10-24T16:00:00.000Z',
    }, NOW).reason, 'REQUEST_LIFETIME_EXCEEDS_LIMIT')
  })
})
