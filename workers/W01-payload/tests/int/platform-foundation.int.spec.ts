import { describe, expect, it } from 'vitest'
import {
  canonicalListEnvelope,
  errorResponse,
  listResponse,
  okResponse,
  parsePagination,
  requestContextFrom,
} from '../../../src/platform/http/foundation'

describe('W01 canonical HTTP foundation', () => {
  it('generates a canonical request id when the incoming id is absent', () => {
    const context = requestContextFrom(new Request('https://example.test/v1/test'))
    expect(context.requestId).toMatch(/^req_[A-Za-z0-9_-]+$/)
    expect(context.requestId.length).toBeGreaterThanOrEqual(5)
  })

  it('preserves valid request and trace identifiers', () => {
    const request = new Request('https://example.test/v1/test', {
      headers: {
        'x-request-id': 'req_ABC_123',
        'x-trace-id': 'trace-abc:123',
        'x-correlation-id': 'corr-123',
      },
    })

    expect(requestContextFrom(request)).toEqual({
      requestId: 'req_ABC_123',
      traceId: 'trace-abc:123',
      correlationId: 'corr-123',
    })
  })

  it('rejects malformed identifiers by generating a fresh request id and omitting invalid trace id', () => {
    const request = new Request('https://example.test/v1/test', {
      headers: {
        'x-request-id': 'bad request id',
        'x-trace-id': 'bad trace id',
      },
    })

    const context = requestContextFrom(request)
    expect(context.requestId).toMatch(/^req_[A-Za-z0-9_-]+$/)
    expect(context.traceId).toBeUndefined()
  })

  it('uses the contract default pagination limit', () => {
    expect(parsePagination(new URL('https://example.test/v1/items'))).toEqual({ limit: 20 })
  })

  it('enforces the contract maximum pagination limit', () => {
    expect(parsePagination(new URL('https://example.test/v1/items?limit=101'))).toEqual({
      error: 'VALIDATION_FAILED',
      message: 'Invalid limit',
    })
  })

  it('treats the cursor as opaque and enforces only the contract size boundary', () => {
    expect(parsePagination(new URL('https://example.test/v1/items?cursor=opaque-token&limit=10'))).toEqual({
      cursor: 'opaque-token',
      limit: 10,
    })
    expect(parsePagination(new URL(`https://example.test/v1/items?cursor=${'x'.repeat(2049)}`))).toEqual({
      error: 'INVALID_CURSOR',
      message: 'Invalid cursor',
    })
  })

  it('emits the canonical error response envelope', async () => {
    const response = errorResponse(
      { requestId: 'req_test', traceId: 'trace-test' },
      'NOT_FOUND',
      'Content not found',
      { resource: 'content' },
    )

    expect(response.status).toBe(404)
    expect(response.headers.get('x-request-id')).toBe('req_test')
    expect(response.headers.get('x-trace-id')).toBe('trace-test')
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Content not found',
        details: { resource: 'content' },
      },
      requestId: 'req_test',
      traceId: 'trace-test',
    })
  })

  it('requires explicit HTTP status when the contract does not provide one', () => {
    expect(() =>
      errorResponse({ requestId: 'req_test' }, 'INVALID_CURSOR', 'Invalid cursor'),
    ).toThrowError(/HTTP status is not contractually mapped/)
  })

  it('emits canonical success and list envelopes', async () => {
    const ok = okResponse({ requestId: 'req_test' }, { id: 'u1' })
    await expect(ok.json()).resolves.toEqual({
      data: { id: 'u1' },
      requestId: 'req_test',
    })

    const list = listResponse({ requestId: 'req_test' }, [{ id: 'u1' }], 'opaque-next', true)
    await expect(list.json()).resolves.toEqual({
      data: {
        items: [{ id: 'u1' }],
        nextCursor: 'opaque-next',
        hasMore: true,
      },
      requestId: 'req_test',
    })
  })

  it('keeps list envelope construction independent from ordering policy', () => {
    expect(canonicalListEnvelope([{ id: 1 }], null, false)).toEqual({
      items: [{ id: 1 }],
      nextCursor: null,
      hasMore: false,
    })
  })
})
