export const ERROR_HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  IDEMPOTENCY_IN_PROGRESS: 409,
  PRECONDITION_FAILED: 412,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  IDEMPOTENCY_KEY_REUSE_CONFLICT: 422,
  VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  PRECONDITION_REQUIRED: 428,
  INTERNAL_ERROR: 500,
  DEPENDENCY_FAILED: 502,
  SERVICE_UNAVAILABLE: 503,
}

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'INVALID_STATE',
  'PRECONDITION_FAILED',
  'PRECONDITION_REQUIRED',
  'CONFLICT',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_IN_PROGRESS',
  'IDEMPOTENCY_KEY_REUSE_CONFLICT',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPLOAD_REJECTED',
  'RESOURCE_LOCKED',
  'INVALID_CURSOR',
  'CURSOR_EXPIRED',
  'DEPENDENCY_FAILED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const

export type ErrorCode = (typeof ERROR_CODES)[number]

export type ApiError = {
  code: ErrorCode
  message: string
  details: Record<string, unknown>
}

export type RequestContext = {
  requestId: string
  traceId?: string
  correlationId?: string
}

export type Pagination = {
  cursor?: string
  limit: number
}

export type ListData<T> = {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

const REQUEST_ID_PATTERN = /^req_[A-Za-z0-9_-]+$/
const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/
const CURSOR_MAX_LENGTH = 2048
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

function isValidRequestId(value: string | null): value is string {
  return value !== null && value.length >= 5 && value.length <= 128 && REQUEST_ID_PATTERN.test(value)
}

function isValidTraceId(value: string | null): value is string {
  return value !== null && value.length >= 1 && value.length <= 128 && TRACE_ID_PATTERN.test(value)
}

function generateRequestId(): string {
  return `req_${crypto.randomUUID().replaceAll('-', '')}`
}

export function requestContextFrom(request: Request): RequestContext {
  const requestId = isValidRequestId(request.headers.get('x-request-id'))
    ? request.headers.get('x-request-id')!
    : generateRequestId()

  const traceId = isValidTraceId(request.headers.get('x-trace-id'))
    ? request.headers.get('x-trace-id')!
    : undefined

  const correlationId = request.headers.get('x-correlation-id')?.trim() || undefined

  return { requestId, traceId, correlationId }
}

export function responseHeaders(context: RequestContext): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-request-id': context.requestId,
  })
  if (context.traceId) headers.set('x-trace-id', context.traceId)
  if (context.correlationId) headers.set('x-correlation-id', context.correlationId)
  return headers
}

export function errorResponse(
  context: RequestContext,
  code: ErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  status = ERROR_HTTP_STATUS[code],
): Response {
  if (status === undefined) {
    throw new Error(`HTTP status is not contractually mapped for error code: ${code}`)
  }

  const body: {
    error: ApiError
    requestId: string
    traceId?: string
  } = {
    error: { code, message, details },
    requestId: context.requestId,
  }

  if (context.traceId) body.traceId = context.traceId

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(context),
  })
}

export function okResponse<T>(context: RequestContext, data: T, status = 200): Response {
  const body: {
    data: T
    requestId: string
    traceId?: string
  } = {
    data,
    requestId: context.requestId,
  }

  if (context.traceId) body.traceId = context.traceId

  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(context),
  })
}

export function listResponse<T>(
  context: RequestContext,
  items: T[],
  nextCursor: string | null,
  hasMore: boolean,
): Response {
  const data: ListData<T> = { items, nextCursor, hasMore }
  return okResponse(context, data)
}

export function parsePagination(url: URL): Pagination | { error: 'INVALID_CURSOR' | 'VALIDATION_FAILED'; message: string } {
  const cursor = url.searchParams.get('cursor') ?? undefined
  if (cursor !== undefined && (cursor.length < 1 || cursor.length > CURSOR_MAX_LENGTH)) {
    return { error: 'INVALID_CURSOR', message: 'Invalid cursor' }
  }

  const rawLimit = url.searchParams.get('limit')
  if (rawLimit === null || rawLimit === '') return { limit: DEFAULT_LIMIT, cursor }

  if (!/^[0-9]+$/.test(rawLimit)) {
    return { error: 'VALIDATION_FAILED', message: 'Invalid limit' }
  }

  const limit = Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return { error: 'VALIDATION_FAILED', message: 'Invalid limit' }
  }

  return { limit, cursor }
}

export function canonicalListEnvelope<T>(
  items: T[],
  nextCursor: string | null,
  hasMore: boolean,
): ListData<T> {
  return { items, nextCursor, hasMore }
}
