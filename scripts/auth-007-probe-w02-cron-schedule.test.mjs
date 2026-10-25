import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probeW02CronSchedule } from './auth-007-probe-w02-cron-schedule.mjs'

const validConfig = {
  accountId: '0123456789abcdef0123456789abcdef',
  apiToken: 'test-token-value-with-enough-length',
}

const response = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
})

describe('AUTH-007 read-only W02 Cron Trigger schedule probe', () => {
  it('requests only the deployed schedules endpoint with GET', async () => {
    let request
    const result = await probeW02CronSchedule({
      ...validConfig,
      fetchImpl: async (url, options) => {
        request = { url, options }
        return response(200, { success: true, result: { schedules: [{ cron: '* * * * *' }] } })
      },
    })
    assert.equal(request.url, 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/scripts/luckread-w02/schedules')
    assert.equal(request.options.method, 'GET')
    assert.equal(result.status, 'PASS')
    assert.equal(result.category, 'NONE')
    assert.equal(result.scheduleCount, 1)
    assert.equal(result.expectedCronPresent, true)
  })

  it('fails closed when configuration is absent without making a request', async () => {
    let requests = 0
    const result = await probeW02CronSchedule({
      accountId: '',
      apiToken: '',
      fetchImpl: async () => { requests += 1; return response(200, {}) },
    })
    assert.equal(requests, 0)
    assert.equal(result.status, 'FAIL')
    assert.equal(result.category, 'CONFIGURATION_MISSING')
    assert.equal(result.httpStatus, 'NONE')
  })

  it('classifies authentication, scope, rate and API failures without response details', async () => {
    const cases = [
      [403, 'AUTH_OR_PERMISSION'],
      [404, 'WORKER_OR_SCOPE_NOT_FOUND'],
      [429, 'RATE_LIMITED'],
      [503, 'CLOUDFLARE_API_FAILURE_REDACTED'],
    ]
    for (const [status, category] of cases) {
      const result = await probeW02CronSchedule({
        ...validConfig,
        fetchImpl: async () => response(status, { success: false, secret: 'must-not-escape' }),
      })
      assert.equal(result.status, 'FAIL')
      assert.equal(result.category, category)
      assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
    }
  })

  it('reports a missing expected cron without echoing other expressions', async () => {
    const result = await probeW02CronSchedule({
      ...validConfig,
      fetchImpl: async () => response(200, {
        success: true,
        result: { schedules: [{ cron: '15 * * * *' }, { cron: 'secret schedule' }] },
      }),
    })
    assert.equal(result.status, 'FAIL')
    assert.equal(result.category, 'EXPECTED_CRON_NOT_REGISTERED')
    assert.equal(result.scheduleCount, 2)
    assert.equal(result.expectedCronPresent, false)
    assert.equal(JSON.stringify(result).includes('secret schedule'), false)
  })

  it('fails closed for malformed API responses and JSON errors', async () => {
    const malformed = await probeW02CronSchedule({
      ...validConfig,
      fetchImpl: async () => response(200, { success: true, result: {} }),
    })
    const invalidJson = await probeW02CronSchedule({
      ...validConfig,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('private body') } }),
    })
    assert.equal(malformed.category, 'CLOUDFLARE_API_FAILURE_REDACTED')
    assert.equal(invalidJson.category, 'CLOUDFLARE_API_FAILURE_REDACTED')
    assert.equal(JSON.stringify(invalidJson).includes('private body'), false)
  })

  it('classifies network failures without retaining thrown details', async () => {
    const result = await probeW02CronSchedule({
      ...validConfig,
      fetchImpl: async () => { throw new Error('connection with private token') },
    })
    assert.equal(result.status, 'FAIL')
    assert.equal(result.category, 'NETWORK_OR_CONNECTION')
    assert.equal(JSON.stringify(result).includes('private token'), false)
  })
})
