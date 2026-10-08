import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('content state adapters', () => {
  it('enforces If-Match and Idempotency-Key at the public v1 boundary', () => {
    const route = read('src/app/api/v1/contents/[contentId]/state/route.ts')
    expect(route).toContain('requireStatePreconditions')
    expect(route).toContain("request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("request.headers.get('If-Match')?.trim() ?? ''")
    expect(route).toContain('idempotencyKey.length > 256')
    expect(route).toContain('ifMatch.length > 256')
    expect(route).toContain("ifMatch === '*'")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain("'PRECONDITION_FAILED'")
    expect(route).toContain("method: 'POST'")
    expect(route).toContain('callW03Content')
  })

  it('enforces the same preconditions on the Creator Center state route', () => {
    const route = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    expect(route).toContain('requireStatePreconditions')
    expect(route).toContain("request.headers.get('Idempotency-Key')?.trim() ?? ''")
    expect(route).toContain("request.headers.get('If-Match')?.trim() ?? ''")
    expect(route).toContain('idempotencyKey.length > 256')
    expect(route).toContain('ifMatch.length > 256')
    expect(route).toContain("ifMatch === '*'")
    expect(route).toContain("'PRECONDITION_REQUIRED'")
    expect(route).toContain("'PRECONDITION_FAILED'")
    expect(route).toContain('callW03Content')
  })
})

describe('creator content lifecycle cache adapters', () => {
  it('invalidates public content views after Creator Center state transitions', () => {
    const route = read('src/app/(payload)/api/creator/contents/[contentId]/state/route.ts')
    expect(route).toContain("invalidatePublicContentComments(contentId)")
    expect(route).toContain("invalidatePublicContentVisibility(contentId)")
    expect(route).toContain("invalidatePublicContentRelationships(contentId)")
    expect(route).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(route).toContain("invalidatePublicContentList(request)")
    expect(route).toContain("if (response.ok)")
    expect(route).toContain("method: 'POST'")
  })

  it('invalidates public content views after Creator Center deletion of published content', () => {
    const route = read('src/app/(payload)/api/creator/contents/[contentId]/route.ts')
    expect(route).toContain("export async function DELETE")
    expect(route).toContain("method: 'DELETE'")
    expect(route).toContain("invalidatePublicContentComments(contentId)")
    expect(route).toContain("invalidatePublicContentVisibility(contentId)")
    expect(route).toContain("invalidatePublicContentRelationships(contentId)")
    expect(route).toContain("invalidatePublicContentDetail(request, contentId)")
    expect(route).toContain("invalidatePublicContentList(request)")
    expect(route).toContain("if (response.ok)")
  })
})
