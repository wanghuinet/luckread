const getCookieValue = (request: Request, name: string): string | null => {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return null

  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=')
    if (separator < 0) continue

    const key = segment.slice(0, separator).trim()
    if (key !== name) continue

    const value = segment.slice(separator + 1).trim()
    if (!value) return null

    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return null
}

export function readPayloadAccessToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? ''
  if (authorization.startsWith('Bearer ')) {
    const token = authorization.slice('Bearer '.length).trim()
    if (token) return token
  }

  return getCookieValue(request, 'payload-token')
}

export function getPayloadAuthorizationHeader(request: Request): string | null {
  const token = readPayloadAccessToken(request)
  return token ? 'Bearer ' + token : null
}

// Payload's native auth() must succeed before this non-verifying claim read is used.
export function readVerifiedPayloadTokenVersion(request: Request): number | null {
  const token = readPayloadAccessToken(request)
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = atob(padded)
    const claims = JSON.parse(json) as { tokenVersion?: unknown }
    return typeof claims.tokenVersion === 'number' &&
      Number.isSafeInteger(claims.tokenVersion) &&
      claims.tokenVersion >= 0
      ? claims.tokenVersion
      : null
  } catch {
    return null
  }
}
