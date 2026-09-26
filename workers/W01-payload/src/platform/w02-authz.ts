import { requestContextFrom, type RequestContext } from './http/foundation'

export type LayerResolution = {
  decision: 'ALLOW' | 'DENY'
  layer?: string
}

export type ResolveLayerInput = {
  subjectId: string
  accountState: string
  now?: string
  context: RequestContext
  signal?: AbortSignal
}

export interface W02AuthService {
  fetch(request: Request): Promise<Response>
}

export class W02AuthzTransportError extends Error {
  constructor(
    readonly code: 'DEPENDENCY_FAILED' | 'VALIDATION_FAILED',
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message)
  }
}

const INTERNAL_AUTHZ_URL = 'https://w02.internal/internal/authz/resolve-layer'

function assertInput(input: ResolveLayerInput): void {
  if (!input || typeof input !== 'object') {
    throw new W02AuthzTransportError('VALIDATION_FAILED', 'resolve-layer input is required')
  }

  if (typeof input.subjectId !== 'string' || input.subjectId.length < 1 || input.subjectId.length > 128) {
    throw new W02AuthzTransportError('VALIDATION_FAILED', 'subjectId must be 1-128 characters')
  }

  if (typeof input.accountState !== 'string' || input.accountState.length < 1 || input.accountState.length > 64) {
    throw new W02AuthzTransportError('VALIDATION_FAILED', 'accountState must be 1-64 characters')
  }

  if (!input.context || typeof input.context.requestId !== 'string' || input.context.requestId.length < 1) {
    throw new W02AuthzTransportError('VALIDATION_FAILED', 'request context is required')
  }
}

function requestHeaders(context: RequestContext): Headers {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    accept: 'application/json',
    'x-request-id': context.requestId,
  })

  if (context.traceId) headers.set('x-trace-id', context.traceId)
  if (context.correlationId) headers.set('x-correlation-id', context.correlationId)

  return headers
}

function parseLayerResolution(value: unknown): LayerResolution {
  if (!value || typeof value !== 'object') {
    throw new W02AuthzTransportError('DEPENDENCY_FAILED', 'invalid W02 authorization response')
  }

  const decision = (value as { decision?: unknown }).decision
  if (decision !== 'ALLOW' && decision !== 'DENY') {
    throw new W02AuthzTransportError('DEPENDENCY_FAILED', 'invalid W02 authorization decision')
  }

  const layer = (value as { layer?: unknown }).layer

  if (decision === 'ALLOW') {
    if (typeof layer !== 'string' || !/^L[0-8]$/.test(layer)) {
      throw new W02AuthzTransportError('DEPENDENCY_FAILED', 'invalid W02 authorization layer')
    }
    return { decision, layer }
  }

  if (layer !== undefined) {
    throw new W02AuthzTransportError('DEPENDENCY_FAILED', 'DENY response must not carry a layer')
  }

  return { decision: 'DENY' }
}

function dependencyError(error: unknown, upstreamStatus?: number): W02AuthzTransportError {
  if (error instanceof W02AuthzTransportError) return error
  return new W02AuthzTransportError(
    'DEPENDENCY_FAILED',
    error instanceof Error ? error.message : 'W02 authorization service unavailable',
    upstreamStatus,
  )
}

export function createW02AuthzClient(service: W02AuthService) {
  return {
    async resolveLayer(input: ResolveLayerInput): Promise<LayerResolution> {
      try {
        assertInput(input)

        if (input.signal?.aborted) {
          throw new W02AuthzTransportError('DEPENDENCY_FAILED', 'W02 authorization request aborted')
        }

        const request = new Request(INTERNAL_AUTHZ_URL, {
          method: 'POST',
          headers: requestHeaders(input.context),
          body: JSON.stringify({
            subjectId: input.subjectId,
            accountState: input.accountState,
            ...(input.now !== undefined ? { now: input.now } : {}),
          }),
          redirect: 'error',
          signal: input.signal,
        })

        let response: Response
        try {
          response = await service.fetch(request)
        } catch (error) {
          throw dependencyError(error)
        }

        if (!response.ok) {
          throw new W02AuthzTransportError(
            'DEPENDENCY_FAILED',
            'W02 authorization request failed',
            response.status,
          )
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch (error) {
          throw dependencyError(error, response.status)
        }

        return parseLayerResolution(payload)
      } catch (error) {
        if (error instanceof W02AuthzTransportError) throw error
        throw dependencyError(error)
      }
    },
  }
}

export function createW02AuthzContext(request: Request): RequestContext {
  return requestContextFrom(request)
}
