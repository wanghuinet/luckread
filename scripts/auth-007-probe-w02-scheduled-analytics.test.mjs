import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probeW02ScheduledAnalytics } from './auth-007-probe-w02-observability.mjs'

const valid = {
  accountId: '0123456789abcdef0123456789abcdef',
  apiToken: 'test-token-value-with-enough-length',
  now: 1_800_000_000_000,
}
const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
})

describe('AUTH-007 least-privilege W02 scheduled analytics probe', () => {
  it('uses one bounded GraphQL read and returns only a scoped aggregate count', async () => {
    let request
    const result = await probeW02ScheduledAnalytics({
      ...valid,
      fetchImpl: async (url, init) => {
        request = { url, init, body: JSON.parse(init.body) }
        return response(200, {
          data: {
            viewer: {
              accounts: [{
                workersInvocationsScheduled: [
                  { scriptName: 'luckread-w02', datetime: new Date(valid.now - 60_000).toISOString(), status: 'success', privateId: 'must-not-escape' },
                  { scriptName: 'another-worker', datetime: new Date(valid.now - 60_000).toISOString() },
                  { scriptName: 'luckread-w02', datetime: new Date(valid.now - 1_900_000).toISOString() },
                  { scriptName: 'luckread-w02', datetime: 'malformed-time' },
                ],
              }],
            },
          },
        })
      },
    })
    assert.equal(request.url, 'https://api.cloudflare.com/client/v4/graphql')
    assert.equal(request.init.method, 'POST')
    assert.equal(request.body.variables.accountTag, valid.accountId)
    assert.equal(request.body.variables.scriptName, 'luckread-w02')
    assert.equal(Date.parse(request.body.variables.end) - Date.parse(request.body.variables.start), 1_800_000)
    assert.match(request.body.query, /workersInvocationsScheduled/)
    assert.equal(result.scheduledAnalyticsStatus, 'PASS')
    assert.equal(result.scheduledAnalyticsRows, 1)
    assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
    assert.equal(JSON.stringify(result).includes('privateId'), false)
  })

  it('fails closed on missing configuration without issuing a request', async () => {
    let calls = 0
    const result = await probeW02ScheduledAnalytics({
      accountId: '',
      apiToken: '',
      now: valid.now,
      fetchImpl: async () => { calls += 1; return response(200, {}) },
    })
    assert.equal(calls, 0)
    assert.equal(result.scheduledAnalyticsStatus, 'FAIL')
    assert.equal(result.scheduledAnalyticsCategory, 'CONFIGURATION_MISSING')
  })

  it('redacts GraphQL schema or permission errors even when HTTP returns 200', async () => {
    const result = await probeW02ScheduledAnalytics({
      ...valid,
      fetchImpl: async () => response(200, { errors: [{ message: 'private token or account diagnostic' }] }),
    })
    assert.equal(result.scheduledAnalyticsStatus, 'FAIL')
    assert.equal(result.scheduledAnalyticsCategory, 'GRAPHQL_QUERY_OR_PERMISSION_ERROR')
    assert.equal(result.scheduledAnalyticsHttpStatus, 200)
    assert.equal(JSON.stringify(result).includes('private token'), false)
    assert.equal(JSON.stringify(result).includes('account diagnostic'), false)
  })
})
