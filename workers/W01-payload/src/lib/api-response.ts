const requestId = (): string => `req_${crypto.randomUUID()}`

const mappedError = (status: number, fallbackMessage: string): { status: number; code: string; message: string } => {
  if (status === 401) return { status: 401, code: 'UNAUTHENTICATED', message: 'Authentication required' }
  if (status === 403) return { status: 403, code: 'PERMISSION_DENIED', message: 'Permission denied' }
  if (status === 404) return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' }
  if (status === 409) return { status: 409, code: 'CONFLICT', message: 'Request conflicts with current resource state' }
  if (status === 412) return { status: 412, code: 'PRECONDITION_FAILED', message: 'Request precondition failed' }
  if (status === 413) return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request payload is too large' }
  if (status === 415) return { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported media type' }
  if (status === 423) return { status: 423, code: 'RESOURCE_LOCKED', message: 'Resource is locked' }
  if (status === 428) return { status: 428, code: 'PRECONDITION_REQUIRED', message: 'Required request precondition is missing' }
  if (status === 429) return { status: 429, code: 'RATE_LIMITED', message: 'Too many requests' }
  if (status >= 500) return { status: 503, code: 'SERVICE_UNAVAILABLE', message: fallbackMessage }
  return { status: 422, code: 'VALIDATION_FAILED', message: 'Invalid request' }
}

export const apiErrorResponse = (
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
): Response => Response.json(
  { error: { code, message, details: {} }, requestId: requestId() },
  {
    status,
    headers: {
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  },
)

export const normalizeApiErrorResponse = (
  response: Response,
  fallbackMessage: string,
): Response => {
  const mapped = mappedError(response.status, fallbackMessage)
  const retryAfter = response.headers.get('retry-after')
  return apiErrorResponse(
    mapped.status,
    mapped.code,
    mapped.message,
    retryAfter ? { 'retry-after': retryAfter } : {},
  )
}

export async function appendRequestIdToJsonResponse(response: Response): Promise<Response> {
  if (response.status === 204 || !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return response
  }

  let body: unknown
  try {
    body = await response.clone().json()
  } catch {
    return response
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return response

  const record = body as Record<string, unknown>
  if (typeof record.requestId === 'string' && /^req_[A-Za-z0-9_-]{1,124}$/.test(record.requestId)) {
    return response
  }

  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({ ...record, requestId: requestId() }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
