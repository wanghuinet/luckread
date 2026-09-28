import { randomBytes, randomUUID } from 'node:crypto'
import { getPayload } from 'payload'

const { default: config } = await import(new URL('../src/payload.config.ts', import.meta.url).href)
const payload = await getPayload({ config })

const suffix = randomUUID().replaceAll('-', '')
const email = 'auth004-local-' + suffix + '@luckread.local'
const password = 'Evd-AUTH004-' + randomBytes(18).toString('base64url')
const changed = 'Evd-AUTH004-Changed-' + randomBytes(18).toString('base64url')
const reset = 'Evd-AUTH004-Reset-' + randomBytes(18).toString('base64url')

const created = await payload.create({
  collection: 'users',
  data: { email, username: 'auth004l' + suffix.slice(0, 14), password },
})
const userId = String(created.id)

const login1 = await payload.login({
  collection: 'users',
  data: { email, password },
})
const login2 = await payload.login({
  collection: 'users',
  data: { email, password },
})
if (!login1.user?.id || !login2.user?.id) throw new Error('native local login failed')
const sessionIds = (user) =>
  Array.isArray(user?.sessions)
    ? user.sessions.map((session) => String(session?.id ?? '')).filter(Boolean)
    : []

const beforeSessionSnapshot = await payload.findByID({
  collection: 'users',
  id: userId,
  depth: 0,
  overrideAccess: true,
  showHiddenFields: true,
})
const beforeSessionIds = sessionIds(beforeSessionSnapshot)
if (beforeSessionIds.length < 2) {
  throw new Error('expected at least two native sessions before password change')
}


await payload.update({
  collection: 'users',
  id: userId,
  data: { password: changed },
  user: login1.user,
})

const afterSessionSnapshot = await payload.findByID({
  collection: 'users',
  id: userId,
  depth: 0,
  overrideAccess: true,
  showHiddenFields: true,
})
const afterSessionIds = sessionIds(afterSessionSnapshot)
const retainedExistingSessions = beforeSessionIds.filter((id) => afterSessionIds.includes(id))
const existingSessionRevocation =
  afterSessionIds.length < beforeSessionIds.length && retainedExistingSessions.length < beforeSessionIds.length
if (!existingSessionRevocation) {
  throw new Error('native password change did not revoke at least one affected existing session')
}

let oldPasswordRejected = false
try {
  await payload.login({
    collection: 'users',
    data: { email, password },
  })
} catch {
  oldPasswordRejected = true
}
if (!oldPasswordRejected) throw new Error('old password remained valid after change')

const changedLogin = await payload.login({
  collection: 'users',
  data: { email, password: changed },
})
if (!changedLogin.user?.id) throw new Error('changed password login failed')

const resetToken = await payload.forgotPassword({
  collection: 'users',
  data: { email },
  disableEmail: true,
})
if (!resetToken) throw new Error('native forgotPassword did not return a reset token in Local API')

const firstReset = await payload.resetPassword({
  collection: 'users',
  data: { token: resetToken, password: reset },
})
if (!firstReset.user) throw new Error('native resetPassword failed')

let replayRejected = false
try {
  await payload.resetPassword({
    collection: 'users',
    data: {
      token: resetToken,
      password: 'Evd-AUTH004-Replay-' + randomBytes(18).toString('base64url'),
    },
  })
} catch {
  replayRejected = true
}
if (!replayRejected) throw new Error('reset token replay was accepted')

const expiredToken = await payload.forgotPassword({
  collection: 'users',
  data: { email },
  disableEmail: true,
})
await payload.update({
  collection: 'users',
  id: userId,
  data: { resetPasswordExpiration: new Date(Date.now() - 60_000).toISOString() },
  overrideAccess: true,
})

let expiredRejected = false
try {
  await payload.resetPassword({
    collection: 'users',
    data: {
      token: expiredToken,
      password: 'Evd-AUTH004-Expired-' + randomBytes(18).toString('base64url'),
    },
  })
} catch {
  expiredRejected = true
}
if (!expiredRejected) throw new Error('expired reset token was accepted')

await payload.delete({ collection: 'users', id: userId, overrideAccess: true })

console.log(
  JSON.stringify(
    {
      featureId: 'AUTH-004',
      mode: 'PAYLOAD_NATIVE_LOCAL_API',
      assertions: {
        passwordChangeInvalidatesOldCredential: oldPasswordRejected,
        changedPasswordAccepted: true,
        existingSessionRevocation,
        resetTokenSingleUse: replayRejected,
        sessionsBeforePasswordChange: beforeSessionIds.length,
        sessionsAfterPasswordChange: afterSessionIds.length,
        retainedExistingSessions: retainedExistingSessions.length,
        expiredResetTokenRejected: expiredRejected,
        secretsRecorded: false,
      },
    },
    null,
    2,
  ),
)

process.exit(0)
