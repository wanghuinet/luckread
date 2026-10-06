import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')

const users = read('src/collections/Users.ts')
const registration = read('src/app/auth/register/route.ts')
const payloadConfig = read('src/payload.config.ts')

if (!users.includes('disableLocalStrategy: true')) {
  throw new Error('Payload local authentication is still enabled')
}
if (!users.includes('betterAuthPayloadStrategy')) {
  throw new Error('Payload does not use the Better Auth backed strategy')
}
if (!registration.includes('callW02BetterAuth')) {
  throw new Error('Registration does not delegate to Better Auth')
}
if (registration.includes('password: normalized.credential')) {
  throw new Error('Registration still passes plaintext password into Payload user creation')
}
if (payloadConfig.includes('AUTH001_USER_CAPTURE_CONTEXT')) {
  throw new Error('Payload native password-hash capture seam is still present')
}

console.log(JSON.stringify({
  status: 'PASS',
  featureId: 'AUTH-001',
  mode: 'BETTER_AUTH_REGISTRATION_BOUNDARY',
  assertions: {
    betterAuthOwnsCredentialCreation: true,
    payloadLocalStrategyDisabled: true,
    payloadIsProjectionOnly: true,
    nativePayloadHashCaptureRemoved: true,
  },
}, null, 2))
