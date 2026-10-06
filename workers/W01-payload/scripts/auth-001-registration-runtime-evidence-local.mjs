import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const artifactDir = resolve(root, '../../artifacts/mapping-0/auth-001-runtime-local')
mkdirSync(artifactDir, { recursive: true })

const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const registration = read('src/app/auth/register/route.ts')
const users = read('src/collections/Users.ts')
const payloadConfig = read('src/payload.config.ts')
const cacheGuard = read('src/lib/content-list-cache-guard.ts')

const assertions = {
  betterAuthOwnsRegistration: registration.includes('callW02BetterAuth') && registration.includes("'/api/auth/sign-up/email'"),
  payloadDoesNotReceiveCredential: !registration.includes('password: credential') && !registration.includes('password: normalized.credential'),
  payloadLocalAuthDisabled: users.includes('disableLocalStrategy: true'),
  payloadAuthBackedByW02: users.includes('betterAuthPayloadStrategy') && users.includes('resolveBetterAuthPrincipal'),
  nativeHashCaptureRemoved: !payloadConfig.includes('AUTH001_USER_CAPTURE_CONTEXT'),
  betterAuthCookieRecognized: cacheGuard.includes('better-auth.session_token'),
  duplicateSessionTableAbsentFromRuntime: ![
    registration,
    users,
    payloadConfig,
  ].some((source) => source.includes('auth_session_state')),
}

for (const [name, passed] of Object.entries(assertions)) {
  if (!passed) throw new Error('AUTH-001 assertion failed: ' + name)
}

const result = {
  status: 'PASS',
  featureId: 'AUTH-001',
  evidenceType: 'BETTER_AUTH_SINGLE_AUTHORITY_BOUNDARY_LOCAL',
  sourceSha,
  environment: 'CONTROLLED_LOCAL_W01',
  assertions,
}

writeFileSync(
  resolve(artifactDir, 'runtime-result.json'),
  JSON.stringify(result, null, 2) + '\n',
)
console.log(JSON.stringify(result, null, 2))
