import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probeW02TailAccess } from './auth-007-probe-w02-tail-access.mjs'

const accountId = '2f80471e375649f98db17707a433ad64'
const apiToken = 'a'.repeat(40)

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  }
}

describe('AUTH-007 read-only W02 Tail access probe', () => {
  it('passes only for a successful Tail API response and never logs payloads', async () => {
    let observed
    const result = await probeW02TailAccess({
      accountId,
      apiToken,
      fetchImpl: async (url, init) => {
        observed = { url, init }
        return response(200, { success: true, result: [{ id: 'tail-id', url: 'private-url' }] })
      },
    })
    assert.deepEqual(result, { status: 'PASS', category: 'NONE', httpStatus: 200 })
    assert.match(observed.url, /workers\/scripts\/luckread-w02\/tails$/)
    assert.equal(observed.init.method, 'GET')
    assert.equal(observed.init.headers.authorization, `Bearer ${apiToken}`)
  })

  it('classifies missing credentials without making a request', async () => {
    let called = false
    const result = await probeW02TailAccess({
      accountId: '',
      apiToken: '',
      fetchImpl: async () => { called = true },
    })
    assert.deepEqual(result, { status: 'FAIL', category: 'CONFIGURATION_MISSING', httpStatus: 'NONE' })
    assert.equal(called, false)
  })

  it('classifies forbidden responses as an access/permission issue', async () => {
    const result = await probeW02TailAccess({
      accountId,
      apiToken,
      fetchImpl: async () => response(403, { errors: [{ message: 'sensitive diagnostic' }] }),
    })
    assert.deepEqual(result, { status: 'FAIL', category: 'AUTH_OR_PERMISSION', httpStatus: 403 })
    assert.equal(JSON.stringify(result).includes('sensitive diagnostic'), false)
  })

  it('classifies a missing script as a W02 worker/scope issue', async () => {
    const result = await probeW02TailAccess({
      accountId, apiToken, fetchImpl: async () => response(404, {}),
    })
    assert.deepEqual(result, { status: 'FAIL', category: 'WORKER_OR_SCOPE_NOT_FOUND', httpStatus: 404 })
  })

  it('classifies throttling and server failures without exposing the response body', async () => {
    const limited = await probeW02TailAccess({
      accountId, apiToken, fetchImpl: async () => response(429, { detail: 'private' }),
    })
    const server = await probeW02TailAccess({
      accountId, apiToken, fetchImpl: async () => response(503, { detail: 'private' }),
    })
    assert.deepEqual(limited, { status: 'FAIL', category: 'RATE_LIMITED', httpStatus: 429 })
    assert.deepEqual(server, { status: 'FAIL', category: 'CLOUDFLARE_API_FAILURE_REDACTED', httpStatus: 503 })
  })

  it('classifies transport and malformed success responses safely', async () => {
    const network = await probeW02TailAccess({
      accountId, apiToken, fetchImpl: async () => { throw new Error('private network detail') },
    })
    const malformed = await probeW02TailAccess({
      accountId, apiToken, fetchImpl: async () => response(200, { success: false, errors: [{ message: 'private' }] }),
    })
    assert.deepEqual(network, { status: 'FAIL', category: 'NETWORK_OR_CONNECTION', httpStatus: 'NONE' })
    assert.deepEqual(malformed, { status: 'FAIL', category: 'CLOUDFLARE_API_FAILURE_REDACTED', httpStatus: 200 })
  })
})
