export type AuthEmailEnvironment = {
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  waitUntil?: (promise: Promise<unknown>) => void
}

export type AuthEmailMessage = {
  to: string
  subject: string
  text: string
  html: string
}

export class AuthEmailDeliveryError extends Error {
  constructor(readonly code: 'AUTH_EMAIL_DELIVERY_UNCONFIGURED' | 'AUTH_EMAIL_DELIVERY_FAILED') {
    super(code)
  }
}

export const hasAuthEmailConfig = (env: AuthEmailEnvironment): boolean =>
  typeof env.RESEND_API_KEY === 'string' &&
  env.RESEND_API_KEY.trim().length > 0 &&
  typeof env.AUTH_EMAIL_FROM === 'string' &&
  env.AUTH_EMAIL_FROM.trim().length > 0

const escapeHtml = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export async function sendAuthEmail(
  env: AuthEmailEnvironment,
  message: AuthEmailMessage,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.AUTH_EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    throw new AuthEmailDeliveryError('AUTH_EMAIL_DELIVERY_UNCONFIGURED')
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })

  if (!response.ok) {
    try { await response.body?.cancel() } catch {}
    throw new AuthEmailDeliveryError('AUTH_EMAIL_DELIVERY_FAILED')
  }
}

/**
 * Queue email delivery on the active Worker request when possible. Configuration
 * failures are synchronous so signup can fail closed before Better Auth creates
 * an identity. Provider delivery failures are recorded without logging PII.
 */
export async function dispatchAuthEmail(
  env: AuthEmailEnvironment,
  message: AuthEmailMessage,
): Promise<void> {
  if (!hasAuthEmailConfig(env)) {
    throw new AuthEmailDeliveryError('AUTH_EMAIL_DELIVERY_UNCONFIGURED')
  }

  const delivery = sendAuthEmail(env, message)
  if (env.waitUntil) {
    env.waitUntil(delivery.catch((error: unknown) => {
      const diagnosticCode = error instanceof AuthEmailDeliveryError
        ? error.code
        : 'AUTH_EMAIL_DELIVERY_FAILED'
      console.error(JSON.stringify({
        event: 'auth.email_delivery_failed',
        diagnosticCode,
      }))
    }))
    return
  }

  await delivery
}

export const escapeAuthEmailHtml = escapeHtml
