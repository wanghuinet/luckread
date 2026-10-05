import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createLuckReadAuth: vi.fn(),
  reconcileOrphanedSessionExtensions: vi.fn(),
  getSession: vi.fn(),
  changePassword: vi.fn(),
}))

vi.mock('../auth/better-auth.js', () => ({
  createLuckReadAuth: mocks.createLuckReadAuth,
}))

vi.mock('../session/session-runtime.js', () => ({
  reconcileOrphanedSessionExtensions: mocks.reconcileOrphanedSessionExtensions,
}))

import {
  changePasswordWithBetterAuth,
  PasswordChangeServiceError,
} from './password-change.js'

describe('W02 Better Auth password change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({
      user: { id: 'user-7' },
      session: { id: 'session-7' },
    })
    mocks.changePassword.mockResolvedValue({})
    mocks.reconcileOrphanedSessionExtensions.mockResolvedValue(2)
    mocks.createLuckReadAuth.mockReturnValue({
      api: {
        getSession: mocks.getSession,
        changePassword: mocks.changePassword,
      },
    })
  })

  it('verifies the current session, changes the password through Better Auth, and revokes other sessions', async () => {
    const request = new Request('https://luckread.test/api/auth/change-password', {
      method: 'POST',
      headers: {
        cookie: 'better-auth.session_token=test',
      },
    })

    await changePasswordWithBetterAuth(
      {} as D1Database,
      request,
      'test-secret',
      {
        currentPassword: 'Current-password-123!',
        newPassword: 'New-password-456!',
      },
    )

    expect(mocks.changePassword).toHaveBeenCalledWith({
      body: {
        currentPassword: 'Current-password-123!',
        newPassword: 'New-password-456!',
        revokeOtherSessions: true,
      },
      headers: request.headers,
    })
    expect(mocks.reconcileOrphanedSessionExtensions).toHaveBeenCalledWith(
      expect.anything(),
      'user-7',
      'session-7',
      expect.any(String),
    )
  })

  it('rejects an unauthenticated password change before invoking Better Auth mutation', async () => {
    mocks.getSession.mockResolvedValue(null)

    await expect(
      changePasswordWithBetterAuth(
        {} as D1Database,
        new Request('https://luckread.test/api/auth/change-password'),
        'test-secret',
        {
          currentPassword: 'Current-password-123!',
          newPassword: 'New-password-456!',
        },
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    })

    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it('rejects invalid password lengths before invoking Better Auth', async () => {
    await expect(
      changePasswordWithBetterAuth(
        {} as D1Database,
        new Request('https://luckread.test/api/auth/change-password'),
        'test-secret',
        {
          currentPassword: 'short',
          newPassword: 'New-password-456!',
        },
      ),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    })

    expect(mocks.changePassword).not.toHaveBeenCalled()
  })

  it('maps Better Auth invalid-password errors without exposing provider details', async () => {
    mocks.changePassword.mockRejectedValue({
      statusCode: 401,
      body: { code: 'INVALID_PASSWORD' },
      message: 'secret provider detail',
    })

    await expect(
      changePasswordWithBetterAuth(
        {} as D1Database,
        new Request('https://luckread.test/api/auth/change-password'),
        'test-secret',
        {
          currentPassword: 'Current-password-123!',
          newPassword: 'New-password-456!',
        },
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Current password is invalid',
    })

    await expect(
      changePasswordWithBetterAuth(
        {} as D1Database,
        new Request('https://luckread.test/api/auth/change-password'),
        'test-secret',
        {
          currentPassword: 'Current-password-123!',
          newPassword: 'New-password-456!',
        },
      ),
    ).rejects.toMatchObject({
      message: 'Current password is invalid',
    })
  })
})
