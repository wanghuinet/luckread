import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const baseUrl = String(process.env.W01_BASE_URL ?? '').replace(/\/+$/, '')
const ownerToken = process.env.MEDIA_OWNER_TOKEN
const otherToken = process.env.MEDIA_OTHER_TOKEN
const mediaId = String(process.env.MEDIA_ID ?? '').trim()
const runId = String(process.env.GITHUB_RUN_ID ?? 'local')
const evidenceDir = 'artifacts/mapping-0/media-runtime-e2e'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, { token, method = 'GET', headers = {}, body } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  })
  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}
  return { response, raw, data }
}

function listIds(data, label) {
  const docs = data?.docs ?? data?.data?.docs ?? data?.items ?? data?.data?.items
  assert(Array.isArray(docs), label + ' response did not contain a document list')
  return docs.map((doc) => String(doc?.id ?? ''))
}

const required = { baseUrl, ownerToken, otherToken, mediaId }
for (const [name, value] of Object.entries(required)) assert(Boolean(value), 'Missing required environment value: ' + name)

mkdirSync(evidenceDir, { recursive: true })

// Verify W01 media-library listing still reads the owner's media record and
// never discloses the same record in another creator's library.
const [ownerLibrary, otherLibrary] = await Promise.all([
  request('/api/v1/media?limit=50', { token: ownerToken }),
  request('/api/v1/media?limit=50', { token: otherToken }),
])
assert(ownerLibrary.response.ok, 'Owner media library failed: HTTP ' + ownerLibrary.response.status)
assert(otherLibrary.response.ok, 'Non-owner media library failed: HTTP ' + otherLibrary.response.status)
const ownerIds = listIds(ownerLibrary.data, 'Owner media library')
const otherIds = listIds(otherLibrary.data, 'Non-owner media library')
assert(ownerIds.includes(mediaId), 'Uploaded media is missing from owner media library')
assert(!otherIds.includes(mediaId), 'Owner media leaked into non-owner media library')
writeFileSync(evidenceDir + '/library.json', JSON.stringify({
  status: 'PASS', runId, mediaId, ownerListingContainsMedia: true, nonOwnerListingExcludesMedia: true,
}, null, 2) + '\n')

// Verify the playback adapter resolves the exact uploaded object, then fetch
// the delivery URL and validate the synthetic PNG signature.
const playback = await request('/api/v1/media/' + encodeURIComponent(mediaId) + '/playback', { token: ownerToken })
assert(playback.response.ok, 'Playback endpoint failed: HTTP ' + playback.response.status)
assert(String(playback.data?.id ?? '') === mediaId, 'Playback media id did not match the uploaded asset')
assert(playback.data?.status === 'READY', 'Playback endpoint did not report READY')
assert(typeof playback.data?.url === 'string' && playback.data.url.trim() === playback.data.url && playback.data.url.length > 0, 'Playback URL was missing or malformed')
// Payload/R2 adapters can return an absolute CDN URL or a path relative to the W01 API origin.
const deliveryUrl = new URL(playback.data.url, baseUrl)
assert(['https:', 'http:'].includes(deliveryUrl.protocol), 'Playback URL used an unsupported protocol')

// The synthetic asset is not attached to published content, so delivery must
// remain private: anonymous and other-account requests are denied, while the
// authenticated owner can fetch and verify the exact uploaded object.
const anonymousDelivery = await fetch(deliveryUrl)
assert([401, 403, 404].includes(anonymousDelivery.status), 'Private media was delivered without owner authentication: HTTP ' + anonymousDelivery.status)
const nonOwnerDelivery = await fetch(deliveryUrl, {
  headers: { authorization: 'Bearer ' + otherToken },
})
assert([401, 403, 404].includes(nonOwnerDelivery.status), 'Private media was delivered to a non-owner: HTTP ' + nonOwnerDelivery.status)
const delivery = await fetch(deliveryUrl, {
  headers: { authorization: 'Bearer ' + ownerToken },
})
assert(delivery.ok, 'Owner media delivery failed: HTTP ' + delivery.status)
const bytes = Buffer.from(await delivery.arrayBuffer())
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
assert(bytes.length > 8, 'Media delivery returned an empty or truncated object')
assert(bytes.subarray(0, 8).equals(pngSignature), 'Delivered object did not match the synthetic PNG upload')
writeFileSync(evidenceDir + '/playback.json', JSON.stringify({
  status: 'PASS', runId, mediaId, playbackReady: true, deliveryHttpStatus: delivery.status,
  downloadedBytes: bytes.length, contentSignature: 'PNG', urlProtocol: deliveryUrl.protocol,
}, null, 2) + '\n')

// Delete explicitly before cleanup, then assert that both the detail route and
// the creator library stop exposing the deleted asset.
const deletion = await request('/api/v1/media/' + encodeURIComponent(mediaId), {
  token: ownerToken,
  method: 'DELETE',
  headers: { 'Idempotency-Key': 'MEDIA-E2E-' + runId + '-DELETE-LIFECYCLE' },
})
assert(deletion.response.ok, 'Owner media deletion failed: HTTP ' + deletion.response.status + ' ' + deletion.raw)
const detailAfterDelete = await request('/api/v1/media/' + encodeURIComponent(mediaId), { token: ownerToken })
assert(detailAfterDelete.response.status === 404, 'Deleted media detail should return 404, got ' + detailAfterDelete.response.status)
const listingAfterDelete = await request('/api/v1/media?limit=50', { token: ownerToken })
assert(listingAfterDelete.response.ok, 'Owner library read after delete failed: HTTP ' + listingAfterDelete.response.status)
assert(!listIds(listingAfterDelete.data, 'Owner media library after delete').includes(mediaId), 'Deleted media remained in owner library')
writeFileSync(evidenceDir + '/deletion.json', JSON.stringify({
  status: 'PASS', runId, mediaId, deleteHttpStatus: deletion.response.status,
  detailAfterDeleteHttpStatus: detailAfterDelete.response.status, libraryAfterDeleteExcludesMedia: true,
}, null, 2) + '\n')

console.log(JSON.stringify({ mediaId, library: 'PASS', playbackDelivery: 'PASS', deletionLifecycle: 'PASS' }))
