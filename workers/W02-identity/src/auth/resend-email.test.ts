import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendResendEmail } from './resend-email.js'

const fetchMock = vi.fn<typeof fetch>()

const configuredEnv = {
  RESEND_API_KEY: 're_test_secret_do_not_log',
  AUTH_EMAIL_FROM: 'noreply@good.luckread.com',
}

const verificationInput = {
  purpose: 'email_verification' as const,
  to: 'reader@example.com',
  subject: 'Verify your LuckRead email',
  text: 'Open https://luckread.test/verify?token=verification-secret',
  html: '<a href="https://luckread.test/verify?token=verification-secret">Verify</a>',
}

describe('shared Resend delivery helper', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('records provider acceptance and message ID without logging PII or secrets', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 're_message_123' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(sendResendEmail(configuredEnv, verificationInput)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
    }))
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.headers).toMatchObject({ authorization: 'Bearer re_test_secret_do_not_log' })
    const payload = JSON.parse(String(init?.body)) as { to?: string[]; from?: string }
    expect(payload.to).toEqual(['reader@example.com'])
    expect(payload.from).toBe('noreply@good.luckread.com')

    const log = info.mock.calls.flat().join(' ')
    expect(log).toContain('AUTH_EMAIL_DELIVERY_ACCEPTED')
    expect(log).toContain('re_message_123')
    expect(log).not.toContain('reader@example.com')
    expect(log).not.toContain('re_test_secret_do_not_log')
    expect(log).not.toContain('verification-secret')
  })

  it('logs a safe rejection diagnostic and propagates a generic internal error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      name: 'validation_error',
      statusCode: 422,
      message: 'invalid recipient reader@example.com token verification-secret',
    }), {
      status: 422,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(sendResendEmail(configuredEnv, verificationInput))
      .rejects.toThrow('AUTH_EMAIL_DELIVERY_REJECTED')

    const log = error.mock.calls.flat().join(' ')
    expect(log).toContain('AUTH_EMAIL_DELIVERY_REJECTED')
    expect(log).toContain('422')
    expect(log).toContain('validation_error')
    expect(log).not.toContain('reader@example.com')
    expect(log).not.toContain('verification-secret')
    expect(log).not.toContain('re_test_secret_do_not_log')
  })

  it('diagnoses network failure without logging request data', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(new Error('network failure for reader@example.com'))

    await expect(sendResendEmail(configuredEnv, verificationInput))
      .rejects.toThrow('AUTH_EMAIL_DELIVERY_NETWORK_FAILURE')

    const log = error.mock.calls.flat().join(' ')
    expect(log).toContain('AUTH_EMAIL_DELIVERY_NETWORK_FAILURE')
    expect(log).not.toContain('reader@example.com')
    expect(log).not.toContain('re_test_secret_do_not_log')
  })

  it('fails immediately when delivery credentials are missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendResendEmail({}, verificationInput))
      .rejects.toThrow('AUTH_EMAIL_DELIVERY_UNCONFIGURED')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error.mock.calls.flat().join(' ')).toContain('AUTH_EMAIL_DELIVERY_UNCONFIGURED')
  })
})
