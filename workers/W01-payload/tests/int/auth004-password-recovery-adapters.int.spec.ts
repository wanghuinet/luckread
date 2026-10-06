import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPayload: vi.fn(),
  changePasswordThroughW02: vi.fn(),
  requestPasswordResetThroughW02: vi.fn(),
  resetPasswordThroughW02: vi.fn(),
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

vi.mock('@/auth/w02-password-recovery-client', () => ({
  requestPasswordResetThroughW02: mocks.requestPasswordResetThroughW02,
  resetPasswordThroughW02: mocks.resetPasswordThroughW02,
  W02PasswordRecoveryClientError: mocks.W02PasswordClientError,
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

describe('AUTH-004 W01 recovery adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.changePasswordThroughW02.mockResolvedValue(undefined)
    mocks.requestPasswordResetThroughW02.mockResolvedValue(undefined)
    mocks.resetPasswordThroughW02.mockResolvedValue(undefined)
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

  it('delegates password change to W02 Better Auth authority', async () => {
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
    expect(mocks.getPayload).not.toHaveBeenCalled()
    expect(mocks.changePasswordThroughW02).toHaveBeenCalledWith(
      expect.any(Request),
      {
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      },
    )
  })

  it('delegates reset request to W02 Better Auth without Payload access', async () => {
    const response = await postResetRequest(
      jsonRequest('https://luckread.test/auth/password/reset/request', {
        identifier: '  User7@Example.COM ',
      }),
    )

    expect(response.status).toBe(202)
    expect(await response.text()).toBe('')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.getPayload).not.toHaveBeenCalled()
    expect(mocks.requestPasswordResetThroughW02).toHaveBeenCalledWith(
      expect.any(Request),
      'user7@example.com',
    )
  })

  it('maps W02 reset-request delivery failures to generic 503', async () => {
    mocks.requestPasswordResetThroughW02.mockRejectedValue(
      new mocks.W02PasswordClientError(503, 'SERVICE_UNAVAILABLE', 'delivery failed'),
    )

    const response = await postResetRequest(
      jsonRequest('https://luckread.test/auth/password/reset/request', {
        identifier: 'user7@example.com',
      }),
    )

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(JSON.stringify(body)).not.toContain('delivery failed')
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('delegates anonymous reset confirmation to W02 Better Auth without exposing the token', async () => {
    const recoveryToken = 'opaque-recovery-token'
    const response = await postResetConfirm(
      jsonRequest('https://luckread.test/auth/password/reset/confirm', {
        recoveryToken,
        newPassword: NEW_PASSWORD,
      }),
    )

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.getPayload).not.toHaveBeenCalled()
    expect(JSON.stringify(Object.fromEntries(response.headers.entries()))).not.toContain(
      recoveryToken,
    )
    expect(mocks.resetPasswordThroughW02).toHaveBeenCalledWith(
      expect.any(Request),
      recoveryToken,
      NEW_PASSWORD,
    )
  })

  it('converges rejected reset tokens on the contracted rejection class', async () => {
    mocks.resetPasswordThroughW02.mockRejectedValue(
      new mocks.W02PasswordClientError(422, 'RECOVERY_TOKEN_REJECTED', 'token rejected'),
    )

    const response = await postResetConfirm(
      jsonRequest('https://luckread.test/auth/password/reset/confirm', {
        recoveryToken: 'expired-token',
        newPassword: NEW_PASSWORD,
      }),
    )

    expect(response.status).toBe(422)
    const body = await response.json()
    expect(body.error.code).toBe('RECOVERY_TOKEN_REJECTED')
    expect(JSON.stringify(body)).not.toContain('expired-token')
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })

  it('enforces the canonical password-length boundary before invoking W02', async () => {
    const response = await postResetConfirm(
      jsonRequest('https://luckread.test/auth/password/reset/confirm', {
        recoveryToken: 'token',
        newPassword: 'too-short',
      }),
    )

    expect(response.status).toBe(422)
    expect(mocks.resetPasswordThroughW02).not.toHaveBeenCalled()
    expect(mocks.getPayload).not.toHaveBeenCalled()
  })
})
