import { randomBytes, randomUUID } from 'node:crypto'
import { getPayload } from 'payload'

const { default: config } = await import(new URL('../src/payload.config.ts', import.meta.url).href)
const payload = await getPayload({ config })

const originalFind = payload.db.find
const originalCreate = payload.db.create
let captured = null

payload.db.find = async (args) => {
  if (args.collection === 'users') {
    return { docs: [], totalDocs: 0, totalPages: 1, page: 1, hasPrevPage: false, hasNextPage: false, limit: 1, pagingCounter: 1 }
  }
  return originalFind(args)
}

payload.db.create = async (args) => {
  if (args.collection === 'users') {
    captured = {
      collection: args.collection,
      data: { ...(args.data ?? {}) },
    }

    return {
      id: 'native-hash-probe-user',
      ...(args.data ?? {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  return originalCreate(args)
}

const email = 'auth001-native-hash-' + randomUUID().replaceAll('-', '') + '@luckread.local'
const username = 'auth001nh' + randomUUID().replaceAll('-', '').slice(0, 12)
const password = 'Evd-AUTH001-NativeHash-' + randomBytes(18).toString('base64url')

await payload.create({
  collection: 'users',
  data: { email, username, password },
  overrideAccess: true,
  disableTransaction: true,
})

payload.db.find = originalFind
payload.db.create = originalCreate

if (!captured) throw new Error('Payload native registration did not reach the intercepted User persistence boundary')
if (typeof captured.data.hash !== 'string' || captured.data.hash.length === 0) {
  throw new Error('Payload native registration did not produce password hash material')
}
if (typeof captured.data.salt !== 'string' || captured.data.salt.length === 0) {
  throw new Error('Payload native registration did not produce password salt material')
}
if ('password' in captured.data) {
  throw new Error('Plaintext password crossed the native persistence boundary')
}
if (captured.data.email !== email || captured.data.username !== username) {
  throw new Error('Native persistence intent did not preserve normalized registration identity fields')
}

console.log(
  JSON.stringify(
    {
      featureId: 'AUTH-001',
      mode: 'PAYLOAD_NATIVE_HASH_CAPTURE',
      assertions: {
        payloadNativeRegistrationPathExecuted: true,
        hashProduced: true,
        saltProduced: true,
        plaintextPasswordPersisted: false,
        identityFieldsCaptured: true,
      },
      capturedKeys: Object.keys(captured.data).sort(),
      hashLength: captured.data.hash.length,
      saltLength: captured.data.salt.length,
    },
    null,
    2,
  ),
)

process.exit(0)
