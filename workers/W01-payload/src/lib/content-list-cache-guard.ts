export class ContentListQueryError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const CONTENT_TYPES = new Set(['article', 'post', 'video'])
const MAX_QUERY_LENGTH = 4096
const MAX_CURSOR_LENGTH = 2048

export const validateContentListQuery = (url: URL): URLSearchParams => {
  if (url.search.length > MAX_QUERY_LENGTH) {
    throw new ContentListQueryError('VALIDATION_FAILED', 422)
  }

  const allowed = ['cursor', 'creatorId', 'limit', 'type'] as const
  const query = new URLSearchParams()

  for (const key of allowed) {
    const values = url.searchParams.getAll(key)
    if (values.length > 1) {
      throw new ContentListQueryError('VALIDATION_FAILED', 422)
    }
    if (values.length === 0) continue

    const value = values[0]?.trim() ?? ''
    if (!value) {
      throw new ContentListQueryError('VALIDATION_FAILED', 422)
    }

    if (key === 'cursor') {
      if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new ContentListQueryError('VALIDATION_FAILED', 422)
      }
    } else if (key === 'creatorId') {
      if (!RESOURCE_ID.test(value)) {
        throw new ContentListQueryError('VALIDATION_FAILED', 422)
      }
    } else if (key === 'limit') {
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) {
        throw new ContentListQueryError('VALIDATION_FAILED', 422)
      }
    } else if (!CONTENT_TYPES.has(value)) {
      throw new ContentListQueryError('VALIDATION_FAILED', 422)
    }

    query.set(key, value)
  }

  return query
}

const AUTH_SESSION_COOKIE_NAMES = new Set([
  // Better Auth's canonical session cookie plus secure-cookie variants.
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  '__Host-better-auth.session_token',
  // Retained only as a defensive compatibility guard for legacy clients.
  'payload-token',
])

export const hasAuthenticatedSessionCredential = (request: Request): boolean => {
  if (request.headers.get('Authorization')?.trim()) return true

  const cookieHeader = request.headers.get('cookie') ?? ''
  return cookieHeader.split(';').some((part) => {
    const separator = part.indexOf('=')
    if (separator <= 0) return false

    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    return AUTH_SESSION_COOKIE_NAMES.has(name) && value.length > 0
  })
}
