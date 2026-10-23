import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('trends server-rendered public API boundary', () => {
  it('loads discovery topics through the canonical W01 endpoint and shared transport', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(twitter-clone)/trends/page.tsx'),
      'utf8',
    )

    expect(page).toContain("import { fetchJson } from '../../../lib/client-api.js'")
    expect(page).toContain("PUBLIC_API_ORIGIN = 'https://api.luckread.com'")
    expect(page).toContain("PUBLIC_API_ORIGIN + '/v1/discovery/topics?'")
    expect(page).toContain('fetchJson<{ data?: DiscoveryTopicPageData }>(request)')
    expect(page).toContain("cache: 'no-store'")
    expect(page).not.toContain('callW05SocialPublic')
    expect(page).not.toContain('w05-social-client')
    expect(page).not.toContain('cachedPublicGet')
    expect(page).not.toContain('enforcePublicReadRateLimit')
    expect(page).not.toContain('/internal/social/discovery/topics')
  })

  it('keeps the public trends endpoint, inventory, alignment and operation policy in sync', () => {
    const openapi = readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/openapi.yaml'), 'utf8')
    const inventory = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/api/api-inventory.v1.json'), 'utf8')) as { domains: Record<string, { endpoint_groups: string[] }> }
    const alignment = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/alignment/api-inventory.v1.json'), 'utf8')) as { records: Array<{ operationId: string; method: string; path: string; status: string }> }
    const policy = JSON.parse(readFileSync(resolve(process.cwd(), '../../contracts/openapi/v1/operation-policy.json'), 'utf8')) as { operations: Array<{ operationId: string; auth: { mode: string }; permissions: string[] }> }

    expect(openapi).toContain('  /discovery/topics:')
    expect(openapi).toContain('operationId: getDiscoveryTopics')
    expect(openapi).toContain('updated within the preceding seven days')
    expect(openapi).toContain("nextCursor: { type: [string, 'null'], maxLength: 2048 }")
    expect(inventory.domains.search_discovery.endpoint_groups).toContain('GET /v1/discovery/topics')
    expect(alignment.records.some((record) => record.operationId === 'getDiscoveryTopics' && record.method === 'GET' && record.path === '/v1/discovery/topics')).toBe(true)
    expect(alignment.records.find((record) => record.operationId === 'getDiscoveryTopics')?.status).toBe('DISCOVERED')
    expect(policy.operations.find((operation) => operation.operationId === 'getDiscoveryTopics')).toMatchObject({
      auth: { mode: 'public' },
      permissions: [],
    })
  })
})
