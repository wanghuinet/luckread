import { describe, expect, it } from 'vitest'
import { createW02AuthzClient, W02AuthzTransportError } from '../../src/platform/w02-authz'

const context = {
  requestId: 'req_transport_01',
  traceId: 'trace-01',
  correlationId: 'corr-01',
}

function service(responseFactory: (request: Request) => Response | Promise<Response>) {
  let calls = 0
  let lastRequest: Request | undefined

  return {
    fetch: async (request: Request) => {
      calls += 1
      lastRequest = request
      return responseFactory(request)
    },
    getCalls: () => calls,
    getRequest: () => lastRequest,
  }
}

describe('W01 -> W02 authorization transport', () => {
  it('posts the admitted internal layer request and propagates correlation headers', async () => {
    const target = service(async (request) => {
      expect(request.method).toBe('POST')
      expect(new URL(request.url).pathname).toBe('/internal/authz/resolve-layer')
      expect(request.headers.get('content-type')).toBe('application/json')
      expect(request.headers.get('cache-control')).toBe('no-store')
      expect(request.headers.get('x-request-id')).toBe(context.requestId)
      expect(request.headers.get('x-trace-id')).toBe(context.traceId)
      expect(request.headers.get('x-correlation-id')).toBe(context.correlationId)
      await expect(request.json()).resolves.toEqual({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        now: '2026-09-22T13:00:00.000Z',
      })
      return new Response(JSON.stringify({ decision: 'ALLOW', layer: 'L7' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const result = await createW02AuthzClient(target).resolveLayer({
      subjectId: 'user-1',
      accountState: 'ACTIVE',
      now: '2026-09-22T13:00:00.000Z',
      context,
    })

    expect(result).toEqual({ decision: 'ALLOW', layer: 'L7' })
    expect(target.getCalls()).toBe(1)
  })

  it('returns a valid DENY response without inventing a layer', async () => {
    const target = service(() =>
      new Response(JSON.stringify({ decision: 'DENY' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      createW02AuthzClient(target).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context,
      }),
    ).resolves.toEqual({ decision: 'DENY' })
  })

  it('performs no automatic retry on a dependency failure', async () => {
    const target = service(() => new Response('upstream unavailable', { status: 503 }))

    await expect(
      createW02AuthzClient(target).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context,
      }),
    ).rejects.toMatchObject({
      code: 'DEPENDENCY_FAILED',
      upstreamStatus: 503,
    })

    expect(target.getCalls()).toBe(1)
  })

  it('maps service binding fetch failures to dependency failure without retry', async () => {
    const target = service(() => {
      throw new Error('binding unavailable')
    })

    await expect(
      createW02AuthzClient(target).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context,
      }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_FAILED' })

    expect(target.getCalls()).toBe(1)
  })

  it('fails closed on malformed upstream JSON or layer output', async () => {
    const malformedJson = service(() =>
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      createW02AuthzClient(malformedJson).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context,
      }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_FAILED' })

    const malformedLayer = service(() =>
      new Response(JSON.stringify({ decision: 'ALLOW', layer: 'L9' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      createW02AuthzClient(malformedLayer).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context,
      }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_FAILED' })
  })

  it('rejects invalid request input before making a service call', async () => {
    const target = service(() => new Response('{}', { status: 200 }))

    await expect(
      createW02AuthzClient(target).resolveLayer({
        subjectId: '',
        accountState: 'ACTIVE',
        context,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })

    expect(target.getCalls()).toBe(0)
  })

  it('supports caller-provided AbortSignal instead of inventing a transport timeout', async () => {
    const controller = new AbortController()
    controller.abort()
    const target = service(() => new Response(JSON.stringify({ decision: 'DENY' }), { status: 200 }))

    await expect(
      createW02AuthzClient(target).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_FAILED' })
    expect(target.getCalls()).toBe(1)
  })

  it('omits absent optional correlation headers', async () => {
    const target = service((request) => {
      expect(request.headers.get('x-request-id')).toBe(context.requestId)
      expect(request.headers.get('x-trace-id')).toBeNull()
      expect(request.headers.get('x-correlation-id')).toBeNull()
      return new Response(JSON.stringify({ decision: 'DENY' }), { status: 200 })
    })

    await expect(
      createW02AuthzClient(target).resolveLayer({
        subjectId: 'user-1',
        accountState: 'ACTIVE',
        context: { requestId: context.requestId },
      }),
    ).resolves.toEqual({ decision: 'DENY' })
  })

  it('exports the transport error as a typed dependency boundary', () => {
    const error = new W02AuthzTransportError('DEPENDENCY_FAILED', 'test', 503)
    expect(error.code).toBe('DEPENDENCY_FAILED')
    expect(error.upstreamStatus).toBe(503)
  })
})
