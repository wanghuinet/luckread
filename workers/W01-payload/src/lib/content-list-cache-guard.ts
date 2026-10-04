import { ContentRuntimeError } from './content-list-cache-error.js'

const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const CONTENT_TYPES = new Set(['article', 'post', 'video'])
const MAX_QUERY_LENGTH = 4096
const MAX_CURSOR_LENGTH = 2048

export const validateContentListQuery = (url: URL): URLSearchParams => {
  if (url.search.length > MAX_QUERY_LENGTH) {
    throw new ContentRuntimeError('VALIDATION_FAILED', 400)
  }

  const allowed = ['cursor', 'creatorId', 'limit', 'type'] as const
  const query = new URLSearchParams()

  for (const key of allowed) {
    const values = url.searchParams.getAll(key)
    if (values.length > 1) {
      throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    }
    if (values.length === 0) continue

    const value = values[0]?.trim() ?? ''
    if (!value) {
      throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    }

    if (key === 'cursor') {
      if (value.length > MAX_CURSOR_LENGTH) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
    } else if (key === 'creatorId') {
      if (!RESOURCE_ID.test(value)) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
    } else if (key === 'limit') {
      if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) {
        throw new ContentRuntimeError('VALIDATION_FAILED', 400)
      }
    } else if (!CONTENT_TYPES.has(value)) {
      throw new ContentRuntimeError('VALIDATION_FAILED', 400)
    }

    query.set(key, value)
  }

  return query
}

export const hasAuthenticatedSessionCredential = (request: Request): boolean => {
  if (request.headers.get('Authorization')?.trim()) return true

  const cookieHeader = request.headers.get('cookie') ?? ''
  return cookieHeader.split(';').some((part) => {
    const [name, ...value] = part.trim().split('=')
    return name === 'payload-token' && value.join('=').trim().length > 0
  })
}
