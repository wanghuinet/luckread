import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EXPECTED_HYPERDRIVES,
  WORKER_SCRIPTS,
  collectNeonHyperdriveInventory,
} from './inspect-neon-hyperdrive-live.mjs'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function configFor(expected) {
  return {
    id: `id-${expected.domainId}`,
    name: expected.name,
    origin: {
      database: expected.database,
      host: 'ep-example.us-east-2.aws.neon.tech',
      scheme: 'postgres',
    },
    caching: { disabled: true },
  }
}

test('reads the five expected Hyperdrive configs and all twelve Worker Settings without writes', async () => {
  const requests = []
  const configs = EXPECTED_HYPERDRIVES.map(configFor)
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method, authorization: init.headers?.Authorization })
    assert.equal(init.method, 'GET')
    if (String(url).includes('/hyperdrive/configs?')) {
      return jsonResponse({ success: true, result: configs, result_info: { total_pages: 1 } })
    }
    const worker = WORKER_SCRIPTS.find((item) => String(url).includes(`/scripts/${item.script}/settings`))
    assert.ok(worker)
    return jsonResponse({
      success: true,
      result: {
        bindings: [
          { type: 'd1', name: 'DB' },
          { type: 'hyperdrive', name: 'NEON_READ', id: 'id-D1-01' },
        ],
      },
    })
  }

  const inventory = await collectNeonHyperdriveInventory({
    accountId: 'account-id',
    apiToken: 'read-only-token',
    fetchImpl,
  })

  assert.equal(inventory.readOnly, true)
  assert.equal(inventory.summary.matchedHyperdrives, 5)
  assert.equal(inventory.summary.expectedHyperdrives, 5)
  assert.equal(inventory.summary.canonicalWorkerScripts, 12)
  assert.equal(inventory.workers.length, 12)
  assert.ok(inventory.hyperdrives.every((item) => item.status === 'MATCH'))
  assert.ok(inventory.workers.every((item) => item.status === 'AVAILABLE'))
  assert.ok(inventory.workers.every((item) => item.hyperdriveBindings[0].target === 'D1-01 luckread'))
  assert.ok(inventory.workers.every((item) => item.d1BindingNames.includes('DB')))
  assert.equal(requests.length, 13)
  assert.ok(requests.every((item) => item.method === 'GET'))
  assert.ok(requests.every((item) => item.authorization === 'Bearer read-only-token'))
})

test('paginates the Hyperdrive resource list before matching reserved names', async () => {
  let listCalls = 0
  const padding = Array.from({ length: 100 }, (_, index) => ({ id: `other-${index}`, name: `other-${index}` }))
  const fetchImpl = async (url, init = {}) => {
    assert.equal(init.method, 'GET')
    if (String(url).includes('/hyperdrive/configs?')) {
      listCalls += 1
      if (listCalls === 1) {
        return jsonResponse({ success: true, result: padding, result_info: { total_pages: 2 } })
      }
      return jsonResponse({
        success: true,
        result: EXPECTED_HYPERDRIVES.map(configFor),
        result_info: { total_pages: 2 },
      })
    }
    return jsonResponse({ success: true, result: { bindings: [] } })
  }

  const inventory = await collectNeonHyperdriveInventory({
    accountId: 'account-id',
    apiToken: 'read-only-token',
    fetchImpl,
  })
  assert.equal(listCalls, 2)
  assert.equal(inventory.summary.matchedHyperdrives, 5)
})

test('flags a wrong database, pooler host, enabled cache and missing target', async () => {
  const configs = EXPECTED_HYPERDRIVES.map(configFor)
  configs[1].origin.database = 'wrong-database'
  configs[2].origin.host = 'ep-example-pooler.us-east-2.aws.neon.tech'
  configs[3].caching.disabled = false
  configs.splice(4, 1)

  const inventory = await collectNeonHyperdriveInventory({
    accountId: 'account-id',
    apiToken: 'read-only-token',
    fetchImpl: async (url) => {
      if (String(url).includes('/hyperdrive/configs?')) {
        return jsonResponse({ success: true, result: configs, result_info: { total_pages: 1 } })
      }
      const bindings = String(url).includes('/scripts/luckread-w02/settings')
        ? [{ type: 'hyperdrive', name: 'NEON_DB', id: 'id-D1-02' }]
        : []
      return jsonResponse({ success: true, result: { bindings } })
    },
  })

  assert.deepEqual(inventory.hyperdrives.map((item) => item.status), [
    'MATCH',
    'MISMATCH',
    'MISMATCH',
    'MISMATCH',
    'MISSING',
  ])
  assert.equal(inventory.summary.matchedHyperdrives, 1)
  assert.equal(inventory.summary.missingHyperdrives, 1)
  assert.equal(inventory.summary.mismatchedHyperdrives, 3)
  assert.equal(
    inventory.workers.find((item) => item.worker === 'W02')?.hyperdriveBindings[0]?.target,
    'UNKNOWN_RESOURCE',
  )
})

test('records missing scripts separately from permission/API errors without exposing response messages', async () => {
  const inventory = await collectNeonHyperdriveInventory({
    accountId: 'account-id',
    apiToken: 'read-only-token',
    fetchImpl: async (url) => {
      if (String(url).includes('/hyperdrive/configs?')) {
        return jsonResponse({ success: true, result: EXPECTED_HYPERDRIVES.map(configFor), result_info: { total_pages: 1 } })
      }
      if (String(url).includes('/scripts/luckread-w12/settings')) return jsonResponse({ success: false, errors: [{ code: 10007, message: 'private script detail' }] }, 404)
      if (String(url).includes('/scripts/luckread-w11/settings')) return jsonResponse({ success: false, errors: [{ code: 9109, message: 'secret detail must not escape' }] }, 403)
      return jsonResponse({ success: true, result: { bindings: [] } })
    },
  })

  const w12 = inventory.workers.find((item) => item.worker === 'W12')
  const w11 = inventory.workers.find((item) => item.worker === 'W11')
  assert.equal(w12.status, 'NOT_FOUND')
  assert.equal(w11.status, 'UNAVAILABLE')
  assert.deepEqual(w11.errorCodes, [9109])
  assert.equal(JSON.stringify(inventory).includes('secret detail must not escape'), false)
})
