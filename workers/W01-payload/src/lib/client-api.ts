export type ApiErrorPayload = {
  error?: {
    message?: string
    code?: string
  }
}

export type JsonResponse<T> = {
  response: Response
  data: T | null
}

const CANONICAL_API_HOST = 'api.luckread.com'
const CANONICAL_WEB_HOSTS = new Set([
  'luckread.com',
  'www.luckread.com',
  'mp.luckread.com',
  'sso.luckread.com',
])

/**
 * Keep server-side calls and local/staging origins on their existing transport.
 * In production browsers, translate W01's internal /api/v1 route names into the
 * locked public https://api.luckread.com/v1 URL before making the request.
 */
export function resolvePublicApiRequestUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof window === 'undefined') return input
  if (typeof input !== 'string' && !(input instanceof URL)) return input
  if (!CANONICAL_WEB_HOSTS.has(window.location.hostname)) return input

  let target: URL
  try {
    target = new URL(typeof input === 'string' ? input : input.href, window.location.origin)
  } catch {
    return input
  }

  if (
    target.origin !== window.location.origin ||
    !/^\/api\/v1(?:\/|$)/.test(target.pathname)
  ) return input

  target.protocol = 'https:'
  target.hostname = CANONICAL_API_HOST
  target.port = ''
  target.pathname = target.pathname.replace(/^\/api(?=\/v1(?:\/|$))/, '')
  return target.href
}

function isCanonicalApiRequest(input: RequestInfo | URL): boolean {
  const raw = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
  try {
    return new URL(raw, typeof window === 'undefined' ? 'https://luckread.com' : window.location.origin).hostname === CANONICAL_API_HOST
  } catch {
    return false
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const resolvedInput = resolvePublicApiRequestUrl(input)
  const requestInit = { ...init }
  if (
    typeof window !== 'undefined' &&
    isCanonicalApiRequest(resolvedInput) &&
    (requestInit.credentials === undefined || requestInit.credentials === 'same-origin')
  ) {
    // A same-origin browser call used to send the main site's session cookie
    // automatically. Preserve that behavior after moving the request to api.luckread.com.
    requestInit.credentials = 'include'
  }
  return fetch(resolvedInput, requestInit)
}

export async function readJson<T = unknown>(response: Response): Promise<T | null> {
  return response.json().catch((): null => null) as Promise<T | null>
}

export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<JsonResponse<T>> {
  const response = await apiFetch(input, init)
  return {
    response,
    data: await readJson<T>(response),
  }
}

export function getApiErrorMessage(
  data: unknown,
  fallback: string,
): string {
  if (!data || typeof data !== 'object') return fallback
  const error = 'error' in data && data.error && typeof data.error === 'object' ? data.error : null
  const message = error && 'message' in error ? error.message : undefined
  return typeof message === 'string' && message.trim() ? message : fallback
}

export function jsonHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return headers
}
