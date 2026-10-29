import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('content body access boundary', () => {
  it('checks W03 publication and entitlement before accessing the R2 body object', () => {
    const route = read('src/app/api/v1/contents/[contentId]/body/route.ts')
    const w03Call = route.indexOf('await callW03Content(')
    const assetOwnerCheck = route.indexOf('await isBodyAssetOwnedByContentOwner(')
    const bucketLookup = route.indexOf('await bucket.head(resolved.key)')
    const bucketRead = route.indexOf('await bucket.get(resolved.key)')

    expect(w03Call).toBeGreaterThanOrEqual(0)
    expect(assetOwnerCheck).toBeGreaterThan(w03Call)
    expect(bucketLookup).toBeGreaterThan(assetOwnerCheck)
    expect(bucketRead).toBeGreaterThan(bucketLookup)
    expect(route).toContain("pathname: '/internal/content/contents/' + encodeURIComponent(contentId) + '?bodyContext=1'")
    expect(route).toContain("content.accessMode === 'MEMBERS_ONLY' && content.accessGranted !== true")
    expect(route).toContain("typeof content.bodyRef !== 'string' || !content.bodyRef")
    expect(route).toContain("url.hostname !== 'img.luckread.com'")
    expect(route).toContain('resolveMediaObjectKey(segments)')
    expect(route).toContain("collection: 'media'")
    expect(route).toContain("{ ownerUserId: { equals: ownerId } }")
    expect(route).toContain('doc.url === bodyRef')
    expect(route).toContain('BODY_PREVIEW_MAX_BYTES = 40_000')
    expect(route).toContain('BODY_DETAIL_MAX_BYTES = 1_048_576')
    expect(route).toContain("'cache-control': 'private, no-store'")
    expect(route).toContain("'cdn-cache-control': 'no-store'")
    expect(route).not.toContain('fetch(content.bodyRef')
  })

  it('uses only the same-origin body endpoint from detail and preview clients', () => {
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const preview = read('src/components/ArticleSummaryPreview.tsx')
    const nativeAdapter = read('../../app/lib/content-adapter.ts')

    expect(detail).toContain('/api/v1/contents/')
    expect(detail).toContain('/body')
    expect(detail).not.toContain('apiFetch(resolved.bodyRef, {')
    expect(preview).toContain('/api/v1/contents/')
    expect(preview).toContain('/body?preview=1')
    expect(preview).not.toContain('apiFetch(bodyRef')
    expect(nativeAdapter).toContain('fetchContentBodyById(item.id')
    expect(nativeAdapter).not.toContain('fetchContentBodyReference(url.toString()')
  })
})
