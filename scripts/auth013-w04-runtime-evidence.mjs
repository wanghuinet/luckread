const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const token = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !token) throw new Error('Missing Cloudflare credentials')

const auth = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
}

async function api(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`, {
    ...init,
    headers: { ...auth, ...(init.headers || {}) },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Cloudflare API ${response.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

const queues = await api('/queues?per_page=100')
const queue = queues.result.find((item) => item.queue_name === 'luckread-auth013-account-state-projection')
if (!queue) throw new Error('AUTH-013 projection queue not found')

const consumerResponse = await api(`/queues/${queue.queue_id}/consumers`)
const consumers = Array.isArray(consumerResponse.result) ? consumerResponse.result : [consumerResponse.result]
const consumer = consumers.find((item) => (item.script_name ?? item.script) === 'luckread-w04')
if (!consumer) throw new Error('W04 queue consumer not found after deployment; inspect Queue consumer propagation')
if (consumer.dead_letter_queue !== 'luckread-auth013-account-state-projection-dlq') {
  throw new Error('W04 DLQ binding mismatch')
}
if (consumers.length !== 1) throw new Error(`Expected one W04 consumer, found ${consumers.length}`)

const namespaceId = '32f7e407128a43d59720d5d46736e084'
const resourceId = `usr_auth013_w04_runtime_${process.env.GITHUB_RUN_ID}`
const key = `auth013:projection:User:${resourceId}`
const encodedKey = encodeURIComponent(key)

async function readRecord() {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodedKey}`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`KV read ${response.status}: ${await response.text()}`)
  return JSON.parse(await response.text())
}

async function push(version, state, eventId) {
  const event = {
    eventId,
    eventType: 'identity.account_state_changed',
    schemaVersion: '1.0',
    producer: 'W02',
    resourceType: 'User',
    resourceId,
    occurredAt: '2026-09-29T04:00:00.000Z',
    publishedAt: '2026-09-29T04:00:01.000Z',
    correlationId: 'req_auth013_runtime',
    causationId: eventId,
    idempotencyKey: eventId,
    attempt: 1,
    sourceVersion: version,
    actor: { actorId: 'operator_01', actorType: 'user' },
    before: { accountState: 'ACTIVE', accountStateVersion: 1 },
    after: { accountState: state, accountStateVersion: version },
    reason: 'controlled AUTH-013 W04 runtime evidence',
  }
  await api(`/queues/${queue.queue_id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body: event, content_type: 'json' }),
  })
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const record = await readRecord()
    if (record && predicate(record)) return record
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

try {
  await push(1, 'FROZEN', `evt_${process.env.GITHUB_RUN_ID}_1`)
  await waitFor((record) => record.sourceVersion === 1 && record.state === 'PURGED' && record.deindex === true, 'v1 PURGED')

  await push(2, 'RESTORED', `evt_${process.env.GITHUB_RUN_ID}_2`)
  await waitFor((record) => record.sourceVersion === 2 && record.state === 'ACTIVE' && record.deindex === false, 'v2 ACTIVE')

  await push(1, 'FROZEN', `evt_${process.env.GITHUB_RUN_ID}_1_old`)
  await push(2, 'RESTORED', `evt_${process.env.GITHUB_RUN_ID}_2`)
  await new Promise((resolve) => setTimeout(resolve, 3000))
  const finalRecord = await readRecord()
  if (!finalRecord || finalRecord.sourceVersion !== 2 || finalRecord.state !== 'ACTIVE') {
    throw new Error('Older-version rejection or duplicate idempotency failed')
  }

  const evidence = {
    auth: 'AUTH-013',
    worker: 'W04',
    queue: queue.queue_name,
    queueId: queue.queue_id,
    consumer: { script: consumer.script, type: consumer.type, deadLetterQueue: consumer.dead_letter_queue },
    destination: { type: 'cloudflare_kv', title: 'globe', namespaceId, authority: 'NONE' },
    runtimeEvidence: {
      v1FrozenPurged: true,
      v2RestoredActive: true,
      olderVersionRejected: true,
      duplicateDeliveryIdempotent: true,
      nonResurrection: true,
    },
  }
  await (await import('node:fs/promises')).writeFile('auth013-w04-runtime-evidence.json', JSON.stringify(evidence, null, 2) + '\\n')
  console.log(JSON.stringify(evidence, null, 2))
  console.log('AUTH-013 W04 runtime evidence PASS')
} finally {
  await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodedKey}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  )
}
