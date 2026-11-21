export interface ResendEmailEnv {
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}

export type ResendEmailPurpose = 'email_verification' | 'password_reset'

export type ResendEmailInput = {
  purpose: ResendEmailPurpose
  to: string
  subject: string
  text: string
  html: string
}

const safeProviderField = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(value)) return undefined
  return value
}

/**
 * Shared Resend delivery path for Better Auth verification and password reset.
 * Logs only safe provider diagnostics; never log recipient addresses, message
 * content, verification URLs, or credentials. A 2xx response means the provider
 * accepted the message, not that it reached the recipient's inbox.
 */
export async function sendResendEmail(env: ResendEmailEnv, input: ResendEmailInput): Promise<void> {
  const apiKey = env.RESEND_API_KEY?.trim()
  const from = env.AUTH_EMAIL_FROM?.trim()
  const deliveryAttemptId = crypto.randomUUID()
  const diagnosticPrefix = input.purpose === 'email_verification'
    ? 'AUTH_EMAIL_DELIVERY'
    : 'AUTH_PASSWORD_RESET_DELIVERY'
  const eventPrefix = 'auth.' + input.purpose

  if (!apiKey || !from) {
    console.error(JSON.stringify({
      event: eventPrefix + '.delivery_unconfigured',
      diagnosticCode: diagnosticPrefix + '_UNCONFIGURED',
      deliveryAttemptId,
    }))
    throw new Error(diagnosticPrefix + '_UNCONFIGURED')
  }

  let response: Response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    console.error(JSON.stringify({
      event: eventPrefix + '.delivery_failure',
      diagnosticCode: diagnosticPrefix + (timedOut ? '_TIMEOUT' : '_NETWORK_FAILURE'),
      deliveryAttemptId,
      errorName: error instanceof Error ? error.name : typeof error,
    }))
    throw new Error(diagnosticPrefix + (timedOut ? '_TIMEOUT' : '_NETWORK_FAILURE'))
  }

  let providerPayload: unknown = null
  try {
    providerPayload = await response.json()
  } catch {
    // Some upstream/proxy failures return non-JSON bodies; status remains useful.
  }
  const providerRecord = providerPayload && typeof providerPayload === 'object'
    ? providerPayload as Record<string, unknown>
    : {}

  if (!response.ok) {
    console.error(JSON.stringify({
      event: eventPrefix + '.delivery_failure',
      diagnosticCode: diagnosticPrefix + '_REJECTED',
      deliveryAttemptId,
      status: response.status,
      providerErrorName: safeProviderField(providerRecord.name) ?? null,
      providerErrorCode: safeProviderField(providerRecord.statusCode)
        ?? safeProviderField(providerRecord.code)
        ?? null,
    }))
    throw new Error(diagnosticPrefix + '_REJECTED')
  }

  console.info(JSON.stringify({
    event: eventPrefix + '.delivery_accepted',
    diagnosticCode: diagnosticPrefix + '_ACCEPTED',
    deliveryAttemptId,
    status: response.status,
    providerMessageId: safeProviderField(providerRecord.id) ?? null,
  }))
}
