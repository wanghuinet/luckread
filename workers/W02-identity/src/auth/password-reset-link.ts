const AUTH_ORIGIN = 'https://luckread.com'
const AUTH_RESET_PATH = '/api/auth/reset-password/'
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,512}$/

/**
 * Convert Better Auth's generated token-consumption URL into LuckRead's
 * public recovery page URL. Only the canonical W02 URL is accepted, so an
 * unexpected upstream URL cannot become an email open redirect.
 */
export function buildPasswordResetPageUrl(authGeneratedUrl: string): string {
  let generatedUrl: URL
  try {
    generatedUrl = new URL(authGeneratedUrl)
  } catch {
    throw new Error('INVALID_PASSWORD_RESET_URL')
  }

  if (
    generatedUrl.origin !== AUTH_ORIGIN ||
    generatedUrl.username.length > 0 ||
    generatedUrl.password.length > 0 ||
    !generatedUrl.pathname.startsWith(AUTH_RESET_PATH)
  ) {
    throw new Error('INVALID_PASSWORD_RESET_URL')
  }

  const encodedToken = generatedUrl.pathname.slice(AUTH_RESET_PATH.length)
  let token: string
  try {
    token = decodeURIComponent(encodedToken)
  } catch {
    throw new Error('INVALID_PASSWORD_RESET_URL')
  }

  if (!RESET_TOKEN_PATTERN.test(token)) {
    throw new Error('INVALID_PASSWORD_RESET_URL')
  }

  const resetPageUrl = new URL('/reset-password', AUTH_ORIGIN)
  resetPageUrl.searchParams.set('token', token)
  return resetPageUrl.toString()
}
