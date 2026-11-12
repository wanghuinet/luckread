import test from 'node:test'
import assert from 'node:assert/strict'

import {
  HYPERDRIVE_CONFIG_NAME,
  HYPERDRIVE_TARGETS,
  ensureAllFiveNeonHyperdrive,
  ensureD1_01Hyperdrive,
  parseNeonConnectionString,
} from './create-neon-hyperdrive.mjs'

const connectionString =
  'postgresql://lr_hyperdrive:pa%40ss%2Fword@ep-example.us-east-2.aws.neon.tech:5432/luckread?sslmode=require&channel_binding=require'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('parses only the approved direct Neon D1-01 connection target', () => {
  assert.deepEqual(parseNeonConnectionString(connectionString), {
    database: 'luckread',
    host: 'ep-example.us-east-2.aws.neon.tech',
    password: 'pa@ss/word',
    port: 5432,
    scheme: 'postgres',
    user: 'lr_hyperdrive',
  })
})

test('rejects a Neon pooler endpoint', () => {
  assert.throws(
    () => parseNeonConnectionString(
      'postgres://user:password@ep-example-pooler.us-east-2.aws.neon.tech/luckread?sslmode=require',
    ),
    /direct \(non-pooler\)/,
  )
})

test('rejects a non-Neon database host', () => {
  assert.throws(
    () => parseNeonConnectionString('postgres://user:password@db.example.com/luckread?sslmode=require'),
    /hosted on Neon/,
  )
})

test('rejects a different database and a missing TLS declaration', () => {
  assert.throws(
    () => parseNeonConnectionString('postgres://user:password@ep-example.us-east-2.aws.neon.tech/other?sslmode=require'),
    /exactly luckread/,
  )
  assert.throws(
    () => parseNeonConnectionString('postgres://user:password@ep-example.us-east-2.aws.neon.tech/luckread'),
    /sslmode=require/,
  )
})

test('creates a Hyperdrive resource with TLS-default origin and caching disabled', async () => {
  let createBody
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'GET') {
      return jsonResponse({ success: true, result: [], result_info: { total_pages: 1 } })
    }
    assert.equal(init.method, 'POST')
    createBody = JSON.parse(init.body)
    return jsonResponse({
      success: true,
      result: {
        id: 'hyperdrive-created-id',
        name: HYPERDRIVE_CONFIG_NAME,
        origin: {
          host: createBody.origin.host,
          database: createBody.origin.database,
          user: createBody.origin.user,
          port: createBody.origin.port,
          scheme: createBody.origin.scheme,
        },
        caching: { disabled: true },
      },
    })
  }

  const result = await ensureD1_01Hyperdrive({
    accountId: 'account-id',
    apiToken: 'api-token',
    connectionString,
    fetchImpl,
  })

  assert.deepEqual(result, {
    created: true,
    id: 'hyperdrive-created-id',
    name: HYPERDRIVE_CONFIG_NAME,
  })
  assert.equal(createBody.name, HYPERDRIVE_CONFIG_NAME)
  assert.equal(createBody.origin.password, 'pa@ss/word')
  assert.equal(createBody.caching.disabled, true)
  assert.equal(JSON.stringify(createBody).includes('channel_binding'), false)
})

test('reuses a matching resource without creating a duplicate', async () => {
  let createCalls = 0
  const fetchImpl = async (_url, init = {}) => {
    if (init.method === 'POST') createCalls += 1
    return jsonResponse({
      success: true,
      result: [{
        id: 'existing-id',
        name: HYPERDRIVE_CONFIG_NAME,
        origin: {
          host: 'ep-example.us-east-2.aws.neon.tech',
          database: 'luckread',
          user: 'lr_hyperdrive',
          port: 5432,
          scheme: 'postgres',
        },
        caching: { disabled: true },
      }],
      result_info: { total_pages: 1 },
    })
  }

  const result = await ensureD1_01Hyperdrive({
    accountId: 'account-id',
    apiToken: 'api-token',
    connectionString,
    fetchImpl,
  })

  assert.deepEqual(result, {
    created: false,
    id: 'existing-id',
    name: HYPERDRIVE_CONFIG_NAME,
  })
  assert.equal(createCalls, 0)
})

test('refuses to mutate a reserved name when its existing origin differs', async () => {
  let createCalls = 0
  const fetchImpl = async (_url, init = {}) => {
    if (init.method === 'POST') createCalls += 1
    return jsonResponse({
      success: true,
      result: [{
        id: 'wrong-target-id',
        name: HYPERDRIVE_CONFIG_NAME,
        origin: {
          host: 'another-project.us-east-2.aws.neon.tech',
          database: 'luckread',
          user: 'lr_hyperdrive',
          port: 5432,
          scheme: 'postgres',
        },
        caching: { disabled: true },
      }],
      result_info: { total_pages: 1 },
    })
  }

  await assert.rejects(
    ensureD1_01Hyperdrive({
      accountId: 'account-id',
      apiToken: 'api-token',
      connectionString,
      fetchImpl,
    }),
    /refusing to update it/,
  )
  assert.equal(createCalls, 0)
})


test('prevalidates every Neon target before creating any of the five Hyperdrive resources', async () => {
  let apiCalls = 0
  const connectionStrings = Object.fromEntries(HYPERDRIVE_TARGETS.map((target) => [
    target.secret,
    `postgresql://lr_hyperdrive:password@ep-${target.domainId.toLowerCase()}.us-east-2.aws.neon.tech:5432/${target.database}?sslmode=require&channel_binding=require`,
  ]))
  connectionStrings.NEON_DATABASE_URL_ALLLUCK =
    'postgresql://lr_hyperdrive:password@ep-d1-05.us-east-2.aws.neon.tech:5432/wrong?sslmode=require&channel_binding=require'

  await assert.rejects(
    ensureAllFiveNeonHyperdrive({
      accountId: 'account-id',
      apiToken: 'api-token',
      connectionStrings,
      fetchImpl: async () => {
        apiCalls += 1
        return jsonResponse({ success: true, result: [], result_info: { total_pages: 1 } })
      },
    }),
    /exactly allluck/,
  )
  assert.equal(apiCalls, 0)
})

test('creates one guarded, cache-disabled Hyperdrive resource for each of the five Neon databases', async () => {
  const connectionStrings = Object.fromEntries(HYPERDRIVE_TARGETS.map((target) => [
    target.secret,
    `postgresql://lr_hyperdrive:password@ep-${target.domainId.toLowerCase()}.us-east-2.aws.neon.tech:5432/${target.database}?sslmode=require&channel_binding=require`,
  ]))
  const createBodies = []
  const results = await ensureAllFiveNeonHyperdrive({
    accountId: 'account-id',
    apiToken: 'api-token',
    connectionStrings,
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'GET') {
        return jsonResponse({ success: true, result: [], result_info: { total_pages: 1 } })
      }
      const body = JSON.parse(init.body)
      createBodies.push(body)
      return jsonResponse({
        success: true,
        result: {
          id: `id-${body.origin.database}`,
          name: body.name,
          origin: {
            host: body.origin.host,
            database: body.origin.database,
            user: body.origin.user,
            port: body.origin.port,
            scheme: body.origin.scheme,
          },
          caching: { disabled: true },
        },
      })
    },
  })

  assert.equal(results.length, 5)
  assert.deepEqual(results.map((item) => [item.domainId, item.database, item.name, item.created]), [
    ['D1-01', 'luckread', 'luckread-d1-01-neon', true],
    ['D1-02', 'luckreadpro', 'luckreadpro-d1-02-neon', true],
    ['D1-03', 'luckread_governance', 'luckread-governance-d1-03-neon', true],
    ['D1-04', 'luckread_finance', 'luckread-finance-d1-04-neon', true],
    ['D1-05', 'allluck', 'allluck-d1-05-neon', true],
  ])
  assert.equal(createBodies.length, 5)
  assert.deepEqual(createBodies.map((body) => body.origin.database), HYPERDRIVE_TARGETS.map((target) => target.database))
  assert.ok(createBodies.every((body) => body.caching.disabled === true))
  assert.ok(createBodies.every((body) => !JSON.stringify(body).includes('channel_binding')))
})
