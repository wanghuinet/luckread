import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 content relationship adapters', () => {
  const route = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/contents/[contentId]/relationships/route.ts'),
    'utf8',
  )
  const deleteRoute = readFileSync(
    resolve(process.cwd(), 'src/app/api/v1/contents/[contentId]/relationships/[relationshipId]/route.ts'),
    'utf8',
  )

  it('keeps public relationship reads cache-first and authenticated writes outside shared cache', () => {
    expect(route).toContain("cachedPublicGet")
    expect(route).toContain("'content-relationships'")
    expect(route).toContain("enforcePublicReadRateLimit")
    expect(route).toContain("resolveCookieContentPrincipal")
    expect(route).toContain("method: 'GET'")
    expect(route).toContain("method: 'POST'")
    expect(route).toContain("invalidatePublicContentRelationships")
    expect(route).not.toContain("getPayload(")
    expect(route).not.toContain("content_relationships")
  })

  it('enforces idempotency for relationship creation', () => {
    expect(route).toContain("request.headers.get('Idempotency-Key')")
    expect(route).toContain("Idempotency-Key required")
    expect(route).toContain("idempotencyKey.length > 256")
  })

  it('exposes authenticated relationship revocation and invalidates public cache', () => {
    expect(deleteRoute).toContain("resolveCookieContentPrincipal")
    expect(deleteRoute).toContain("method: 'DELETE'")
    expect(deleteRoute).toContain("/relationships/")
    expect(deleteRoute).toContain("invalidatePublicContentRelationships")
    expect(deleteRoute).toContain("request.headers.get('Idempotency-Key')")
    expect(deleteRoute).not.toContain("content_relationships")
  })
})
