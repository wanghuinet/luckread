import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AuthEmailDeliveryError,
  dispatchAuthEmail,
  hasAuthEmailConfig,
  sendAuthEmail,
  type AuthEmailMessage,
} from './email-delivery.js'

const message: AuthEmailMessage = {
  to: 'reader@example.com',
  subject: 'Verify your LuckRead email',
  text: 'Open https://luckread.com/verify?token=test',
  html: '<a href="https://luckread.com/verify?token=test">Verify email</a>',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('W02 transactional email delivery', () => {
  it('requires both provider credentials and sender configuration', async () => {
    expect(hasAuthEmailConfig({ RESEND_API_KEY: 'key' })).toBe(false)
    expect(hasAuthEmailConfig({ AUTH_EMAIL_FROM: 'LuckRead <no-reply@luckread.com>' })).toBe(false)

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendAuthEmail({ RESEND_API_KEY: 'key' }, message))
      .rejects.toMatchObject({ code: 'AUTH_EMAIL_DELIVERY_UNCONFIGURED' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends only the requested message fields to the configured provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await sendAuthEmail({
      RESEND_API_KEY: 'resend-test-key',
      AUTH_EMAIL_FROM: 'LuckRead <no-reply@luckread.com>',
    }, message)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: 'Bearer resend-test-key',
        'content-type': 'application/json',
      }),
    }))
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      from: 'LuckRead <no-reply@luckread.com>',
      to: ['reader@example.com'],
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  })

  it('fails without exposing provider response bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('provider-secret-detail', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendAuthEmail({
      RESEND_API_KEY: 'bad-key',
      AUTH_EMAIL_FROM: 'LuckRead <no-reply@luckread.com>',
    }, message)).rejects.toBeInstanceOf(AuthEmailDeliveryError)
    await expect(sendAuthEmail({
      RESEND_API_KEY: 'bad-key',
      AUTH_EMAIL_FROM: 'LuckRead <no-reply@luckread.com>',
    }, message)).rejects.toMatchObject({ code: 'AUTH_EMAIL_DELIVERY_FAILED' })
  })

  it('schedules provider delivery with the Worker lifetime hook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const tasks: Promise<unknown>[] = []

    await dispatchAuthEmail({
      RESEND_API_KEY: 'resend-test-key',
      AUTH_EMAIL_FROM: 'LuckRead <no-reply@luckread.com>',
      waitUntil: (promise) => { tasks.push(promise) },
    }, message)

    expect(tasks).toHaveLength(1)
    await Promise.all(tasks)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
