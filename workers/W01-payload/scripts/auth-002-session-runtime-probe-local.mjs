// Local-only AUTH-002 runtime evidence seed probe.
// Creates an isolated test user through the Payload LOCAL API
// (overrideAccess, no HTTP access control involved) so the HTTP
// session lifecycle (login -> me -> logout) can be exercised against
// the local miniflare D1. Prints NO secrets.
//
// Usage: from workers/W01-payload:
//   PAYLOAD_SECRET=ignore pnpm exec tsx scripts/auth-002-session-runtime-probe-local.mjs
import { getPayload } from 'payload'

const email = process.env.PROBE_USER_EMAIL ?? 'evd-session@luckread.local'
const password = process.env.PROBE_USER_PASSWORD ?? 'Evd-Pass-2026!'

const { default: config } = await import(new URL('../src/payload.config.ts', import.meta.url).href)

const payload = await getPayload({ config })
const existing = await payload.find({
  collection: 'users',
  where: { email: { equals: email } },
  limit: 1,
})

let doc
if (existing.docs.length > 0) {
  doc = existing.docs[0]
  console.log(`PROBE_USER_EXISTS id=${doc.id}`)
} else {
  doc = await payload.create({
    collection: 'users',
    data: { email, password },
  })
  console.log(`PROBE_USER_CREATED id=${doc.id}`)
}

console.log('PROBE_SEED_OK')
process.exit(0)
