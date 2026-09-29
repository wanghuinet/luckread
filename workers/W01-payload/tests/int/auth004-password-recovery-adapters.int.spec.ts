import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
}))

vi.mock('payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

import { POST as postPasswordChange } from '../../src/app/auth/password/change/route.js'
import { POST as postResetRequest } from '../../src/app/auth/password/reset/request/route.js'
import { POST as postResetConfirm } from '../../src/app/auth/password/reset/confirm/route.js'

const CURRENT_PASSWORD = 'Current-password-123!'
const NEW_PASSWORD = 'New-password-456!'

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('AUTH-004 W01 Payload-native recovery adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires the contracted Idempotency-Key before password-change work', async () => {
    const response = await postPasswordChange(
      jsonRequest('https://luckread.test/auth/password/change', {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      }),
    )

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('IDEMPOTENCY_KEY_REQUIRED')
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('uses the verified Payload-native principal and delegates password change to native login/update', async () => {
    const user = { id: 'user-7', email: 'User7@Example.com' }
    const login = vi.fn().mockResolvedValue({ user })
    const update = vi.fn().mockResolvedValue({ id: user.id })

    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user }),
      login,
      update,
    })

    const response = await postPasswordChange(
      jsonRequest(
        'https://luckread.test/auth/password/change',
        {
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
          targetUserId: 'attacker-supplied',
        },
        { 'Idempotency-Key': 'auth004-change-1' },
      ),
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(login).toHaveBeenCalledWith({
      collection: 'users',
      data: {
        email: user.email,
        password: CURRENT_PASSWORD,
      },
    })
    expect(update).toHaveBeenCalledWith({
      collection: 'users',
      id: user.id,
      data: { password: NEW_PASSWORD },
      user,
      overrideAccess: false,
    })
  })

  it('fails closed when Payload-native password update fails unexpectedly', async () => {
    const user = { id: 'user-8', email: 'user8@example.com' }
    mocks.getPayload.mockResolvedValue({
      auth: vi.fn().mockResolvedValue({ user }),
      login: vi.fn().mockResolvedValue({ user }),
      update: vi.fn().mockRejectedValue(new Error('database exploded')),
    })

    const response = await postPasswordChange(
      jsonRequest(
        'https://luckread.test/auth/password/change',
        {
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
        },
        { 'Idempotency-Key': 'auth004-change-2' },
      ),
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('database exploded')
  })

  it('keeps reset request enumeration-resistant and delegates to Payload forgotPassword', async () => {
    const forgotPassword = vi.fn().mockResolvedValue(undefined)
    mocks.getPayload.mockResolvedValue({ forgotPassword })

    const response = await postResetRequest(
      jsonRequest('https://luckread.test/auth/password/reset/request', {
        identifier: '  User7@Example.COM ',
      }),
    )

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(forgotPassword).toHaveBeenCalledWith({
      collection: 'users',
      data: { email: 'user7@example.com' },
    })
  })

  it('maps native forgotPassword infrastructure failures to generic 503', async () => {
    mocks.getPayload.mockResolvedValue({
      forgotPassword: vi.fn().mockRejectedValue(new Error('protected lookup failed')),
    })

    const response = await postResetRequest(
      jsonRequest('https://luckread.test/auth/password/reset/request', {
        identifier: 'user7@example.com',
      }),
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('protected lookup failed')
  })

  it('delegates anonymous reset confirmation to Payload resetPassword without exposing the token', async () => {
    const resetPassword = vi.fn().mockResolvedValue({ token: 'new-native-jwt' })
    mocks.getPayload.mockResolvedValue({ resetPassword })

    const recoveryToken = 'opaque-recovery-token'
    const response = await postResetConfirm(
      jsonRequest('https://luckread.test/auth/password/reset/confirm', {
        recoveryToken,
        newPassword: NEW_PASSWORD,
      }),
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(Object.fromEntries(response.headers.entries()))).not.toContain(
      recoveryToken,
    )
    expect(resetPassword).toHaveBeenCalledWith({
      collection: 'users',
      data: {
        token: recoveryToken,
        password: NEW_PASSWORD,
      },
      overrideAccess: false,
    })
  })

  it('converges invalid, expired, or replayed reset tokens on the contracted rejection class', async () => {
    mocks.getPayload.mockResolvedValue({
      resetPassword: vi.fn().mockRejectedValue(new Error('token is expired and invalid')),
    })

    const recoveryToken = 'expired-token'
    const response = await postResetConfirm(
      jsonRequest('https://luckread.test/auth/password/reset/confirm', {
        recoveryToken,
        newPassword: NEW_PASSWORD,
      }),
    )

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error.code).toBe('RECOVERY_TOKEN_REJECTED')
    expect(JSON.stringify(body)).not.toContain(recoveryToken)
  })

  it('enforces the canonical password-length boundary before invoking Payload', async () => {
    const response = await postResetConfirm(
      jsonRequest('https://luckread.test/auth/password/reset/confirm', {
        recoveryToken: 'token',
        newPassword: 'too-short',
      }),
    )

    expect(response.status).toBe(422)
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })
})
