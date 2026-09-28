import { getPayload } from 'payload'
import config from '@payload-config'

const baseUrl = process.env.AUTH001_BASE_URL ?? 'http://127.0.0.1:3100'
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const key = `auth001-${suffix}`
const email = `auth001-${suffix}@example.com`
const username = `auth001_${suffix}`
const consent = { purpose: 'ACCOUNT_REGISTRATION', policyVersion: 'DEV-2026-09-28.1' }

const requestBody = {
  identityType: 'email',
  identity: email,
  credential: 'LongEnoughTestPassword-123!@#',
  username,
  consent,
}

async function post(keyValue, body = requestBody) {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': keyValue },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { response, json }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const payload = await getPayload({ config })
const cleanupIds = { userId: null, consentId: null, envelopeId: null, seededUserId: null }

try {
  const first = await post(key)
  const firstBody = first.json
  assert(first.response.status === 201, `happy path status=${first.response.status} body=${JSON.stringify(firstBody)}`)
  assert(firstBody?.accountState === 'PENDING_VERIFICATION', 'happy path accountState mismatch')
  assert(typeof firstBody?.userId === 'string' && firstBody.userId.length > 0, 'happy path userId missing')
  cleanupIds.userId = firstBody.userId

  const replay = await post(key)
  assert(replay.response.status === 201, `replay status=${replay.response.status}`)
  assert(JSON.stringify(replay.json) === JSON.stringify(firstBody), 'replay body differs from first response')

  const conflict = await post(key, { ...requestBody, username: `${username}_changed` })
  assert(conflict.response.status === 422, `key conflict status=${conflict.response.status}`)
  assert(conflict.json?.error?.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT', `unexpected key conflict=${JSON.stringify(conflict.json)}`)

  const envelopeResult = await payload.find({
    collection: 'auth-registration-envelopes',
    where: { idempotencyKey: { equals: key } },
    limit: 10,
    overrideAccess: true,
  })
  assert(envelopeResult.totalDocs === 1, `expected one envelope, got ${envelopeResult.totalDocs}`)
  const envelope = envelopeResult.docs[0]
  cleanupIds.envelopeId = String(envelope.id)
  assert(envelope.state === 'COMPLETED', `envelope state=${envelope.state}`)
  assert(envelope.consentRecordId, 'consentRecordId missing')

  const consentRecord = await payload.findByID({
    collection: 'consents',
    id: String(envelope.consentRecordId),
    overrideAccess: true,
  })
  cleanupIds.consentId = String(consentRecord.id)
  assert(consentRecord.policyVersion === 'DEV-2026-09-28.1', 'consent policyVersion mismatch')
  assert(consentRecord.retentionClass === 'LEGAL_AUDIT', 'consent retentionClass mismatch')
  assert(consentRecord.state === 'GRANTED', 'consent state mismatch')
  assert(Date.parse(consentRecord.retentionUntil) > Date.now(), 'retentionUntil is not in the future')

  const seededEmail = `auth001-rollback-seed-${suffix}@example.com`
  const seeded = await payload.create({
    collection: 'users',
    data: { email: seededEmail, password: 'LongEnoughTestPassword-456!@#', username: `seed_${suffix}`.slice(0, 128) },
    overrideAccess: true,
    depth: 0,
  })
  cleanupIds.seededUserId = String(seeded.id)

  const rollbackKey = `auth001-rollback-${suffix}`
  const rollbackBody = { ...requestBody, identity: seededEmail, username: `rollback_${suffix}`.slice(0, 128) }
  const rollback = await post(rollbackKey, rollbackBody)
  assert(rollback.response.status === 422, `rollback status=${rollback.response.status}`)

  const rollbackEnvelope = await payload.find({
    collection: 'auth-registration-envelopes',
    where: { idempotencyKey: { equals: rollbackKey } },
    limit: 10,
    overrideAccess: true,
  })
  assert(rollbackEnvelope.totalDocs === 0, `rollback envelope leaked: ${rollbackEnvelope.totalDocs}`)

  const seededConsents = await payload.find({
    collection: 'consents',
    where: { resourceId: { equals: cleanupIds.seededUserId } },
    limit: 10,
    overrideAccess: true,
  })
  assert(seededConsents.totalDocs === 0, `rollback consent leaked: ${seededConsents.totalDocs}`)

  console.log(JSON.stringify({
    result: 'PASS',
    tested: { happyPath: true, duplicateReplay: true, keyReuseConflict: true, consentPersistence: true, rollbackNoPartialWrite: true },
    sourcePolicyVersion: consent.policyVersion,
  }, null, 2))
} catch (error) {
  console.error(error)
  throw error
} finally {
  if (cleanupIds.envelopeId) await payload.delete({ collection: 'auth-registration-envelopes', id: cleanupIds.envelopeId, overrideAccess: true })
  if (cleanupIds.consentId) await payload.delete({ collection: 'consents', id: cleanupIds.consentId, overrideAccess: true })
  if (cleanupIds.userId) await payload.delete({ collection: 'users', id: cleanupIds.userId, overrideAccess: true })
  if (cleanupIds.seededUserId) await payload.delete({ collection: 'users', id: cleanupIds.seededUserId, overrideAccess: true })
}