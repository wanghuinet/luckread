import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  bearer: vi.fn(() => ({})),
  ensureBaseUserRole: vi.fn(),
  reconcileOrphanedSessionExtensions: vi.fn(),
}))

vi.mock('better-auth', () => ({
  betterAuth: mocks.betterAuth,
}))

vi.mock('better-auth/plugins', () => ({
  bearer: mocks.bearer,
}))

vi.mock('../authz/role-assignment.js', () => ({
  ensureBaseUserRole: mocks.ensureBaseUserRole,
}))

vi.mock('../session/session-runtime.js', () => ({
  reconcileOrphanedSessionExtensions: mocks.reconcileOrphanedSessionExtensions,
}))

import { createLuckReadAuth } from './better-auth.js'

describe('W02 Better Auth password reset delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.betterAuth.mockImplementation((options) => options)
    mocks.reconcileOrphanedSessionExtensions.mockResolvedValue(2)
  })

  it('sends reset links through the bound Email Service with the fixed sender', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'm-1' })
    const auth = createLuckReadAuth({
      D1_01: {} as D1Database,
      BETTER_AUTH_SECRET: 'secret-secret-secret-secret-secret-secret',
      EMAIL: { send },
    }) as any

    await auth.emailAndPassword.sendResetPassword({
      user: { email: 'user@example.com' },
      url: 'https://luckread.com/reset-password?token=a&b',
      token: 'a&b',
    })

    expect(send).toHaveBeenCalledWith({
      to: 'user@example.com',
      from: 'noreply@luckread.com',
      subject: 'LuckRead 密码重置',
      text: '请使用以下链接重置你的 LuckRead 密码：\nhttps://luckread.com/reset-password?token=a&b\n\n如果这不是你的操作，请忽略此邮件。',
      html: '<p>请使用以下链接重置你的 LuckRead 密码：</p><p><a href="https://luckread.com/reset-password?token=a&amp;b">重置密码</a></p><p>如果这不是你的操作，请忽略此邮件。</p>',
    })
  })

  it('reconciles orphaned W02 session extensions after a password reset', async () => {
    const auth = createLuckReadAuth({
      D1_01: {} as D1Database,
      BETTER_AUTH_SECRET: 'secret-secret-secret-secret-secret-secret',
      EMAIL: { send: vi.fn().mockResolvedValue({ messageId: 'm-2' }) },
    }) as any

    await auth.emailAndPassword.onPasswordReset({
      user: { id: 'user-7', email: 'user@example.com' },
    })

    expect(mocks.reconcileOrphanedSessionExtensions).toHaveBeenCalledWith(
      expect.anything(),
      'user-7',
      '',
      expect.any(String),
    )
  })

  it('fails closed when Email Service is unavailable', async () => {
    const auth = createLuckReadAuth({
      D1_01: {} as D1Database,
      BETTER_AUTH_SECRET: 'secret-secret-secret-secret-secret-secret',
    }) as any

    await expect(
      auth.emailAndPassword.sendResetPassword({
        user: { email: 'user@example.com' },
        url: 'https://luckread.com/reset-password?token=test',
        token: 'test',
      }),
    ).rejects.toThrow('PASSWORD_RESET_DELIVERY_UNCONFIGURED')
  })
})
