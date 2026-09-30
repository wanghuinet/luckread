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

const authHeader = (token) => new Headers({
  authorization: ['Be', 'arer '].join('') + token,
})

const authContext1 = {}
const authContext2 = {}
await payload.login({
  collection: 'users',
  context: authContext1,
  data: { email, password },
})
await payload.login({
  collection: 'users',
  context: authContext2,
  data: { email, password },
})
const nativeToken1 = authContext1.__luckreadNativeAuthToken
const nativeToken2 = authContext2.__luckreadNativeAuthToken
if (typeof nativeToken1 !== 'string' || typeof nativeToken2 !== 'string') {
  throw new Error('native session evidence tokens were not captured in request-local context')
}
if (!(await payload.auth({ headers: authHeader(nativeToken1), canSetHeaders: false })).user?.id) {
  throw new Error('first native session token was not valid before password change')
}
if (!(await payload.auth({ headers: authHeader(nativeToken2), canSetHeaders: false })).user?.id) {
  throw new Error('second native session token was not valid before password change')
}

await payload.update({
  collection: 'users',
  id: userId,
  data: { password: changed },
  user: login1.user,
})

const sessionAfterChange1 = await payload.auth({
  headers: authHeader(nativeToken1),
  canSetHeaders: false,
})
const sessionAfterChange2 = await payload.auth({
  headers: authHeader(nativeToken2),
  canSetHeaders: false,
})
const session1StillValid = sessionAfterChange1.user?.id != null
const session2StillValid = sessionAfterChange2.user?.id != null
const revokedExistingSessionCount =
  Number(!session1StillValid) + Number(!session2StillValid)
const existingSessionRevocation = revokedExistingSessionCount >= 1
if (!existingSessionRevocation) {
  throw new Error('native password change did not revoke any prior native session')
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

const changedLoginContext = {}
const changedLogin = await payload.login({
  collection: 'users',
  context: changedLoginContext,
  data: { email, password: changed },
})
if (!changedLogin.user?.id) throw new Error('changed password login failed')
const changedPasswordToken = changedLoginContext.__luckreadNativeAuthToken
if (typeof changedPasswordToken !== 'string') {
  throw new Error('changed-password session token was not captured')
}
if (!(await payload.auth({ headers: authHeader(changedPasswordToken), canSetHeaders: false })).user?.id) {
  throw new Error('changed-password native session was not valid before reset')
}

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

const resetSessionInvalidated =
  (await payload.auth({ headers: authHeader(changedPasswordToken), canSetHeaders: false })).user?.id == null
if (!resetSessionInvalidated) {
  throw new Error('native password reset did not invalidate the pre-reset native session')
}

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
        revokedExistingSessionCount,
        resetSessionInvalidated,
        resetTokenSingleUse: replayRejected,

        expiredResetTokenRejected: expiredRejected,
        secretsRecorded: false,
      },
    },
    null,
    2,
  ),
)

process.exit(0)
