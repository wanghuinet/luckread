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
  it('runs dry, bounded, server-side W02 Cron-scoped queries without storing raw evidence', async () => {
    const observed = []
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async (url, init) => {
        const request = { url, init, body: JSON.parse(init.body) }
        observed.push(request)
        if (url.endsWith('/graphql')) {
          return response(200, {
            data: {
              viewer: {
                accounts: [{
                  workersInvocationsScheduled: [
                    { __typename: 'AccountWorkersInvocationsScheduled' },
                  ],
                }],
              },
            },
          })
        }
        if (url.endsWith('/values')) {
          return response(200, {
            success: true,
            result: ['fetch', 'scheduled', 'cron', 'queue'].map((value) => ({
              dataset: 'cloudflare-workers',
              key: '$workers.eventType',
              type: 'string',
              value,
            })),
          })
        }
        if (request.body.view === 'events') {
          return response(200, {
            success: true,
            result: {
              events: {
                events: [
                  {
                    '$workers': { scriptName: 'luckread-w02', eventType: 'scheduled', outcome: 'ok' },
                    source: { message: ['W02 scheduled publication tick', { cron: '* * * * *', privateField: 'must-not-escape' }] },
                  },
                  {
                    '$workers': { scriptName: 'luckread-w02', eventType: 'scheduled', outcome: 'ok' },
                    source: { message: ['W02 scheduled publication result', { task: 'mfa-audit', selected: 2, published: 2, failed: 0, privateField: 'must-not-escape' }] },
                  },
                  {
                    '$workers': { scriptName: 'luckread-w02', eventType: 'cron', outcome: 'exception' },
                    source: { message: ['W02 scheduled publication stage failed', { task: 'mfa-audit', stage: 'mark-published', error: 'private exception' }] },
                  },
                  {
                    '$workers': { scriptName: 'another-worker', eventType: 'scheduled', outcome: 'ok' },
                    source: { message: ['W02 scheduled publication tick', { privateField: 'must-not-escape' }] },
                  },
                ],
              },
            },
          })
        }
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

    assert.equal(observed.length, 4)
    const queryRequests = observed.filter((request) => request.url.endsWith('/query'))
    const valuesRequest = observed.find((request) => request.url.endsWith('/values'))
    const analyticsRequest = observed.find((request) => request.url.endsWith('/graphql'))
    assert.equal(queryRequests.length, 2)
    assert.equal(queryRequests[0].url, 'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/workers/observability/telemetry/query')
    assert.equal(queryRequests[0].init.method, 'POST')
    assert.deepEqual(queryRequests.map((request) => request.body.view).sort(), ['events', 'invocations'])
    assert.equal(queryRequests.find((request) => request.body.view === 'invocations').body.queryId, 'auth007-w02-invocation-diagnostic')
    assert.equal(queryRequests.find((request) => request.body.view === 'events').body.queryId, 'auth007-w02-event-diagnostic')
    assert.equal(valuesRequest.init.method, 'POST')
    assert.equal(analyticsRequest.init.method, 'POST')
    assert.match(analyticsRequest.body.query, /workersInvocationsScheduled/)
    assert.deepEqual(analyticsRequest.body.variables, {
      accountTag: valid.accountId,
      start: new Date(valid.now - 1_800_000).toISOString(),
      end: new Date(valid.now).toISOString(),
      scriptName: 'luckread-w02',
    })
    assert.equal(Date.parse(analyticsRequest.body.variables.end) - Date.parse(analyticsRequest.body.variables.start), 1_800_000)
    assert.deepEqual(valuesRequest.body, {
      datasets: ['cloudflare-workers'],
      key: '$workers.eventType',
      timeframe: { from: valid.now - 1_800_000, to: valid.now },
      type: 'string',
      filters: [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: 'luckread-w02' }],
      limit: 100,
    })
    for (const request of queryRequests) {
      assert.equal(request.body.dry, true)
      assert.equal(request.body.timeframe.to - request.body.timeframe.from, 1_800_000)
      assert.equal(request.body.limit, 100)
      const expectedFilters = [
        { key: '$workers.scriptName', operation: 'eq', type: 'string', value: 'luckread-w02' },
        { key: '$workers.eventType', operation: 'in', type: 'string', value: 'scheduled,cron' },
      ]
      assert.deepEqual(request.body.parameters.filters, expectedFilters)
      assert.equal(request.body.parameters.filterCombination, 'and')
      assert.equal(Object.hasOwn(request.body.parameters, 'limit'), false)
    }
    assert.deepEqual(result, {
      status: 'PASS',
      category: 'NONE',
      httpStatus: 200,
      windowMinutes: 30,
      queriedInvocationGroups: 4,
      w02InvocationGroups: 3,
      fetchInvocations: 1,
      scheduledEventTypeInvocations: 1,
      cronEventTypeInvocations: 1,
      queueInvocations: 0,
      otherEventTypeInvocations: 0,
      unknownEventTypeInvocations: 0,
      scheduledInvocations: 2,
      scheduledExecutionObserved: true,
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
      eventViewStatus: 'PASS',
      eventViewCategory: 'NONE',
      eventViewHttpStatus: 200,
      queriedEventRows: 4,
      w02EventRows: 3,
      fetchEventRows: 0,
      scheduledEventRows: 2,
      cronEventRows: 1,
      queueEventRows: 0,
      otherEventTypeRows: 0,
      unknownEventTypeRows: 0,
      tickMarkerRows: 1,
      resultMarkerRows: 1,
      taskFailureMarkerRows: 0,
      stageFailureMarkerRows: 1,
      eventMfaSummaryLogs: 1,
      eventSelected: 2,
      eventPublished: 2,
      eventFailed: 0,
      eventTypeValuesStatus: 'PASS',
      eventTypeValuesCategory: 'NONE',
      eventTypeValuesHttpStatus: 200,
      eventTypeDistinctValues: 4,
      eventTypeFetchValuePresent: true,
      eventTypeScheduledValuePresent: true,
      eventTypeCronValuePresent: true,
      eventTypeQueueValuePresent: true,
      scheduledAnalyticsStatus: 'PASS',
      scheduledAnalyticsCategory: 'NONE',
      scheduledAnalyticsHttpStatus: 200,
      scheduledAnalyticsRows: 1,
    })
    assert.equal(JSON.stringify(result).includes('must-not-escape'), false)
    assert.equal(JSON.stringify(result).includes('private-request-id'), false)
    assert.equal(JSON.stringify(result).includes('private exception'), false)
  })

  it('distinguishes a visible W02 fetch invocation from missing scheduler evidence', async () => {
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body)
        if (url.endsWith('/graphql')) {
          return response(200, { errors: [{ message: 'private GraphQL error detail' }] })
        }
        if (url.endsWith('/values')) {
          return response(200, { success: true, result: [{
            dataset: 'cloudflare-workers', key: '$workers.eventType', type: 'string', value: 'fetch',
          }] })
        }
        if (body.view === 'events') {
          return response(200, {
            success: true,
            result: {
              events: {
                events: [

                ],
              },
            },
          })
        }
        return response(200, {
          success: true,
          result: {
            invocations: {
              'private-fetch-request-id': [
                { '$workers': { scriptName: 'luckread-w02', eventType: 'fetch', outcome: 'ok' } },
              ],
            },
          },
        })
      },
    })
    assert.equal(result.queriedInvocationGroups, 1)
    assert.equal(result.w02InvocationGroups, 1)
    assert.equal(result.fetchInvocations, 1)
    assert.equal(result.scheduledInvocations, 0)
    assert.equal(result.scheduledExecutionObserved, false)
    assert.equal(result.tickMarkerInvocations, 0)
    assert.equal(result.eventViewStatus, 'PASS')
    assert.equal(result.scheduledEventRows, 0)
    assert.equal(result.scheduledAnalyticsStatus, 'FAIL')
    assert.equal(result.scheduledAnalyticsRows, 0)
    assert.equal(result.scheduledExecutionObserved, false)
    assert.equal(result.tickMarkerRows, 0)
    assert.equal(JSON.stringify(result).includes('private GraphQL error detail'), false)
  })

  it('accepts the explicit W02 tick marker as scheduler evidence when eventType metadata is missing', async () => {
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body)
        if (url.endsWith('/values')) return response(200, { success: true, result: [] })
        if (body.view === 'events') {
          return response(200, {
            success: true,
            result: {
              events: {
                events: [{
                  '$workers': { scriptName: 'luckread-w02' },
                  '$metadata': { message: 'W02 scheduled publication tick' },
                }],
              },
            },
          })
        }
        return response(200, {
          success: true,
          result: {
            invocations: {
              'private-scheduled-request-id': [{
                '$workers': { scriptName: 'luckread-w02' },
              }],
            },
          },
        })
      },
    })
    assert.equal(result.scheduledInvocations, 0)
    assert.equal(result.tickMarkerRows, 1)
    assert.equal(result.scheduledExecutionObserved, true)
  })

  it('uses the independent scheduled-invocation analytics dataset as scheduler evidence', async () => {
    let analyticsRequest
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async (url, init) => {
        const body = JSON.parse(init.body)
        if (url.endsWith('/graphql')) {
          analyticsRequest = body
          return response(200, {
            data: {
              viewer: {
                accounts: [{
                  workersInvocationsScheduled: [
                    { __typename: 'AccountWorkersInvocationsScheduled' },
                    { __typename: 'AccountWorkersInvocationsScheduled' },
                  ],
                }],
              },
            },
          })
        }
        if (url.endsWith('/values')) {
          return response(200, {
            success: true,
            result: [{ dataset: 'cloudflare-workers', key: '$workers.eventType', type: 'string', value: 'fetch' }],
          })
        }
        if (body.view === 'events') {
          return response(200, { success: true, result: { events: { events: [] } } })
        }
        return response(200, { success: true, result: { invocations: {} } })
      },
    })

    assert.match(analyticsRequest.query, /workersInvocationsScheduled/)
    assert.equal(analyticsRequest.variables.scriptName, 'luckread-w02')
    assert.equal(Date.parse(analyticsRequest.variables.end) - Date.parse(analyticsRequest.variables.start), 1_800_000)
    assert.equal(result.scheduledInvocations, 0)
    assert.equal(result.scheduledEventRows, 0)
    assert.equal(result.eventTypeScheduledValuePresent, false)
    assert.equal(result.scheduledAnalyticsStatus, 'PASS')
    assert.equal(result.scheduledAnalyticsRows, 2)
    assert.equal(result.scheduledExecutionObserved, true)
  })

  it('uses the bounded Values endpoint when both query views return no rows', async () => {
    const result = await probeW02ScheduledObservability({
      ...valid,
      fetchImpl: async (url, init) => {
        if (url.endsWith('/values')) {
          const body = JSON.parse(init.body)
          assert.equal(body.key, '$workers.eventType')
          assert.deepEqual(body.filters, [
            { key: '$workers.scriptName', operation: 'eq', type: 'string', value: 'luckread-w02' },
          ])
          return response(200, {
            success: true,
            result: [{
              dataset: 'cloudflare-workers',
              key: '$workers.eventType',
              type: 'string',
              value: 'scheduled',
            }],
          })
        }
        const body = JSON.parse(init.body)
        if (body.view === 'events') return response(200, { success: true, result: { events: { events: [] } } })
        return response(200, { success: true, result: { invocations: {} } })
      },
    })
    assert.equal(result.w02InvocationGroups, 0)
    assert.equal(result.queriedEventRows, 0)
    assert.equal(result.eventTypeValuesStatus, 'PASS')
    assert.equal(result.eventTypeScheduledValuePresent, true)
    assert.equal(result.scheduledExecutionObserved, true)
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
