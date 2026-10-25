import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probeW02ScheduledObservability } from './auth-007-probe-w02-observability.mjs'

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

describe('AUTH-007 read-only W02 scheduled Observability probe', () => {
  it('runs a dry, bounded W02-only query and classifies event types without storing raw evidence', async () => {
    let observed
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async (url, init) => {
        observed = { url, init, body: JSON.parse(init.body) }
        return response(200, {
          success: true,
          result: {
            invocations: {
              'private-request-id': [
                {
                  '$workers': {
                    scriptName: 'luckread-w02',
                    eventType: 'scheduled',
                    outcome: 'ok',
                  },
                  '$metadata': { requestId: 'must-not-escape', message: 'private log metadata' },
                },
                {
                  source: {
                    logs: [
                      { level: 'info', message: [
                        'W02 scheduled publication tick',
                        { cron: '* * * * *', privateField: 'must-not-escape' },
                      ] },
                      { level: 'info', message: [
                        'W02 scheduled publication result',
                        { task: 'mfa-audit', selected: 2, published: 2, failed: 0, privateField: 'must-not-escape' },
                      ] },
                    ],
                  },
                },
              ],
              'private-failed-request-id': [
                {
                  '$workers': {
                    scriptName: 'luckread-w02',
                    eventType: 'cron',
                    outcome: 'exception',
                  },
                  source: { logs: [{ message: [
                    'W02 scheduled publication stage failed',
                    { task: 'mfa-audit', stage: 'mark-published', error: 'private exception' },
                  ] }] },
                },
              ],
              'private-fetch-request-id': [
                { '$workers': { scriptName: 'luckread-w02', eventType: 'fetch', outcome: 'ok' } },
              ],
              'unrelated-request-id': [
                { '$workers': { scriptName: 'another-worker', eventType: 'scheduled', outcome: 'ok' } },
              ],
            },
          },
        })
      },
    })

    assert.equal(observed.url, 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/observability/telemetry/query')
    assert.equal(observed.init.method, 'POST')
    assert.equal(observed.body.dry, true)
    assert.equal(observed.body.view, 'invocations')
    assert.equal(observed.body.queryId, 'auth007-w02-invocation-eventtype-diagnostic')
    assert.equal(observed.body.timeframe.to - observed.body.timeframe.from, 600_000)
    assert.deepEqual(observed.body.parameters.filters.map((filter) => filter.key), [
      '$workers.scriptName',
    ])
    assert.deepEqual(result, {
      status: 'PASS',
      category: 'NONE',
      httpStatus: 200,
      windowMinutes: 10,
      queriedInvocationGroups: 4,
      w02InvocationGroups: 3,
      fetchInvocations: 1,
      scheduledEventTypeInvocations: 1,
      cronEventTypeInvocations: 1,
      queueInvocations: 0,
      otherEventTypeInvocations: 0,
      unknownEventTypeInvocations: 0,
      scheduledInvocations: 2,
      outcomeOk: 1,
      outcomeError: 1,
      outcomeOther: 0,
      tickMarkerInvocations: 1,
      resultMarkerInvocations: 1,
      taskFailureMarkerInvocations: 0,
      stageFailureMarkerInvocations: 1,
      mfaSummaryLogs: 1,
      selected: 2,
      published: 2,
      failed: 0,
    })
    assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
    assert.equal(JSON.stringify(result).includes('private-request-id'), false)
    assert.equal(JSON.stringify(result).includes('private exception'), false)
  })

  it('distinguishes a visible W02 fetch invocation from missing scheduler evidence', async () => {
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async () => response(200, {
        success: true,
        result: {
          invocations: {
            'private-fetch-request-id': [
              { '$workers': { scriptName: 'luckread-w02', eventType: 'fetch', outcome: 'ok' } },
            ],
          },
        },
      }),
    })
    assert.equal(result.queriedInvocationGroups, 1)
    assert.equal(result.w02InvocationGroups, 1)
    assert.equal(result.fetchInvocations, 1)
    assert.equal(result.scheduledInvocations, 0)
    assert.equal(result.tickMarkerInvocations, 0)
  })

  it('does not call Cloudflare when configuration is missing', async () => {
    let calls = 0
    const result = await probeW02ScheduledObservability({
      accountId: '',
      apiToken: '',
      now: valid.now,
      fetchImpl: async () => { calls += 1; return response(200, {}) },
    })
    assert.equal(calls, 0)
    assert.equal(result.status, 'FAIL')
    assert.equal(result.category, 'CONFIGURATION_MISSING')
  })

  it('classifies authentication, missing scope, throttling and server failures without response bodies', async () => {
    for (const [status, category] of [
      [403, 'AUTH_OR_PERMISSION'],
      [404, 'WORKER_OR_DATASET_NOT_FOUND'],
      [429, 'RATE_LIMITED'],
      [503, 'CLOUDFLARE_API_FAILURE_REDACTED'],
    ]) {
      const result = await probeW02ScheduledObservability({
        ...valid,
        fetchImpl: async () => response(status, { secret: 'must-not-escape' }),
      })
      assert.equal(result.status, 'FAIL')
      assert.equal(result.category, category)
      assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
    }
  })

  it('classifies network and malformed responses without retaining details', async () => {
    const network = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async () => { throw new Error('private token transport detail') },
    })
    const malformed = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async () => response(200, { success: true, result: {} }),
    })
    assert.equal(network.category, 'NETWORK_OR_CONNECTION')
    assert.equal(malformed.category, 'MALFORMED_OBSERVABILITY_RESPONSE')
    assert.equal(JSON.stringify(network).includes('private token'), false)
  })
})
