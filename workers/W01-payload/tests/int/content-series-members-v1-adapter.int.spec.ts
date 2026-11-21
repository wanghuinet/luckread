import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('v1 series member adapters', () => {
  it('routes list/attach through W03 and keeps mutation preconditions at the edge', () => {
    const collection = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/series/[seriesId]/members/route.ts'),
      'utf8',
    )
    expect(collection).toContain("'/internal/content/series/'")
    expect(collection).toContain("'/members'")
    expect(collection).toContain("method: 'GET'")
    expect(collection).toContain("method: 'POST'")
    expect(collection).toContain("request.headers.get('If-Match')")
    expect(collection).toContain("request.headers.get('Idempotency-Key')")
    expect(collection).not.toContain('content_relationships')
  })

  it('routes reorder/delete through W03 and never accepts wildcard If-Match', () => {
    const detail = readFileSync(
      resolve(process.cwd(), 'src/app/api/v1/series/[seriesId]/members/[contentId]/route.ts'),
      'utf8',
    )
    expect(detail).toContain("method: 'PATCH'")
    expect(detail).toContain("method: 'DELETE'")
    expect(detail).toContain("ifMatch === '*'")
    expect(detail).toContain("request.headers.get('Idempotency-Key')")
    expect(detail).not.toContain('content_relationships')
  })
})
