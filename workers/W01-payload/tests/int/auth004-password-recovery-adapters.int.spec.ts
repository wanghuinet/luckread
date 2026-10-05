import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  changePasswordThroughW02: vi.fn(),
  W02PasswordClientError: class extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message)
    }
  },
}))

vi.mock('payload', () => ({
  getPayload: mocks.getPayload,
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('@/auth/w02-password-client', () => ({
  changePasswordThroughW02: mocks.changePasswordThroughW02,
  W02PasswordClientError: mocks.W02PasswordClientError,
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
    mocks.changePasswordThroughW02.mockResolvedValue(undefined)
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
    expect(mocks.changePasswordThroughW02).not.toHaveBeenCalled()
  })

  it('delegates password change to the W02 Better Auth authority without trusting caller-supplied user identity', async () => {
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
    expect(mocks.getPayload).not.toHaveBeenCalled()
    expect(mocks.changePasswordThroughW02).toHaveBeenCalledWith(
      expect.any(Request),
      {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    )
  })

  it('fails closed when W02 password change service fails unexpectedly', async () => {
    mocks.changePasswordThroughW02.mockRejectedValue(
      new mocks.W02PasswordClientError(503, 'SERVICE_UNAVAILABLE', 'database exploded'),
    )

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
    expect(mocks.getPayload).not.toHaveBeenCalled()
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
