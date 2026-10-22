import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../../src/app/api/v1/analytics/events/route.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mocks = vi.hoisted(() => ({
  w11Fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({ data: { received: 1 }, requestId: 'corr_route_000001' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  ),
  enforceLimit: vi.fn(async (_request: Request) => undefined),
  resolvePrincipal: vi.fn(async (_request: Request) =>
    null as null | { userId: string; layer: string | null; verified?: boolean } | Response,
  ),
  rateLimitResponse: vi.fn((_request: Request) => new Response(null, { status: 429 })),
}))

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(async () => ({
    env: { W11_ANALYTICS: { fetch: mocks.w11Fetch } },
  })),
}))

vi.mock('../../src/auth/traffic-limit.js', () => ({
  TrafficLimitError: class extends Error {},
  enforceW01WriteRateLimit: mocks.enforceLimit,
  rateLimitResponse: mocks.rateLimitResponse,
}))

vi.mock('../../src/content/w03-content-client.js', () => ({
  resolveOptionalCookieContentPrincipal: mocks.resolvePrincipal,
  W03ContentClientError: class extends Error {
    status = 503
    code = 'SERVICE_UNAVAILABLE'
  },
}))

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

const validEvent = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'evt_valid_0001',
  dedupeKey: 'dedupe_valid_0001',
  eventName: 'content_open',
  occurredAt: '2026-10-22T06:00:00.000Z',
  sessionId: 'session_test_01',
  contentId: 'content_test_01',
  contentType: 'article',
  ...overrides,
})

const requestFor = (events: unknown[]) =>
  new Request('https://www.luckread.com/api/v1/analytics/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-LuckRead-Correlation-Id': 'corr_route_000001',
    },
    body: JSON.stringify({ events }),
  })

beforeEach(() => {
  mocks.w11Fetch.mockClear()
  mocks.enforceLimit.mockClear()
  mocks.resolvePrincipal.mockReset()
  mocks.resolvePrincipal.mockResolvedValue(null)
  mocks.rateLimitResponse.mockClear()
  mocks.w11Fetch.mockImplementation(async () =>
    new Response(
      JSON.stringify({ data: { received: 1 }, requestId: 'corr_route_000001' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  )
})

describe('W01 analytics event route integration', () => {
  it('rate-limits then forwards allowed events and trusted W02 identity without user credentials', async () => {
    mocks.resolvePrincipal.mockResolvedValue({
      userId: 'user_test_01',
      layer: null,
    })

    const response = await POST(requestFor([validEvent()]))

    expect(response.status).toBe(200)
    expect(mocks.enforceLimit).toHaveBeenCalledTimes(1)
    expect(mocks.resolvePrincipal).toHaveBeenCalledTimes(1)
    expect(mocks.w11Fetch).toHaveBeenCalledTimes(1)

    const forwardedInput = mocks.w11Fetch.mock.calls[0]?.[0]
    expect(forwardedInput).toBeInstanceOf(Request)
    const forwarded = forwardedInput as Request
    expect(forwarded.url).toBe('https://luckread-w11.internal/internal/analytics/events')
    expect(forwarded.headers.get('X-LuckRead-Caller')).toBe('W01')
    expect(forwarded.headers.get('X-LuckRead-Transport-Version')).toBe('1.0')
    expect(forwarded.headers.get('X-LuckRead-Correlation-Id')).toBe('corr_route_000001')
    expect(forwarded.headers.get('X-LuckRead-Principal-User-Id')).toBe('user_test_01')
    expect(forwarded.headers.has('Authorization')).toBe(false)
    expect(forwarded.headers.has('Cookie')).toBe(false)
    expect(await forwarded.clone().json()).toEqual({ events: [validEvent()] })
  })

  it('rejects social business events before calling W11', async () => {
    const response = await POST(requestFor([validEvent({ eventName: 'like_created' })]))

    expect(response.status).toBe(422)
    expect(mocks.w11Fetch).not.toHaveBeenCalled()
  })

  it('rejects client-supplied authority fields before calling W11', async () => {
    const response = await POST(requestFor([validEvent({ actorId: 'attacker_user' })]))

    expect(response.status).toBe(422)
    expect(mocks.w11Fetch).not.toHaveBeenCalled()
  })

  it('honors an existing W02 session rejection and does not ingest events', async () => {
    mocks.resolvePrincipal.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), { status: 401 }),
    )

    const response = await POST(requestFor([validEvent()]))

    expect(response.status).toBe(401)
    expect(mocks.w11Fetch).not.toHaveBeenCalled()
  })
})

describe('W01 to W11 analytics event ingress contract', () => {
  it('routes bounded client telemetry through the private W11 service binding', () => {
    const route = read('src/app/api/v1/analytics/events/route.ts')
    const client = read('src/analytics/w11-analytics-client.ts')
    const bindings = read('wrangler.jsonc')
    const w11 = read('../W11-growth-campaign-analytics-operations/src/worker.ts')
    const transport = JSON.parse(read('../../contracts/transport/W01-W11-analytics-event-ingress.v1.json'))

    expect(route).toContain('enforceW01WriteRateLimit(request)')
    expect(route).toContain('resolveOptionalCookieContentPrincipal(request)')
    expect(route).toContain('callW11AnalyticsEvents')
    expect(route).not.toContain('like_created')
    expect(client).toContain("'X-LuckRead-Caller': 'W01'")
    expect(client).toContain("'X-LuckRead-Transport-Version': '1.0'")
    expect(client).toContain('W11_ANALYTICS')
    expect(client).not.toContain("headers.set('Authorization'")
    expect(bindings).toContain('"binding": "W11_ANALYTICS"')
    expect(w11).toContain("url.pathname === '/internal/analytics/events'")
    expect(w11).toContain("request.headers.get('X-LuckRead-Caller') !== 'W01'")
    expect(transport.transport.newQueue).toBe(false)
    expect(transport.persistence.actorVisitorSessionIdsPersisted).toBe(false)
    expect(transport.payload.maximumEventsPerRequest).toBe(90)
    expect(transport.payload.forbiddenEventNames).toContain('like_created')
  })

  it('closes the existing OpenAPI event operation with detailed limits and policy', () => {
    const openapi = read('../../contracts/openapi/v1/openapi.yaml')
    const policy = JSON.parse(read('../../contracts/openapi/v1/operation-policy.json'))
    const detailed = JSON.parse(read('../../contracts/api/analytics-operation-policy.v1.json'))
    const start = openapi.indexOf('  /analytics/events:')
    const end = openapi.indexOf('  /articles:', start)
    const eventBlock = openapi.slice(start, end)
    const operation = policy.operations.find((item: { operationId: string }) => item.operationId === 'postAnalyticsEvents')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(eventBlock).toContain('maxItems: 90')
    expect(eventBlock).toContain('64 KiB')
    expect(eventBlock).not.toContain('DISCOVERY_DRAFT')
    expect(operation.auth.mode).toBe('public')
    expect(operation['x-luckread-source']).toBe('contracts/api/analytics-operation-policy.v1.json')
    expect(detailed.operations[0].operationId).toBe('postAnalyticsEvents')
    expect(detailed.operations[0].queue.enqueueMax).toBe(0)
  })
})
