import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

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
