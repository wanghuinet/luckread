import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ARTICLE_SUMMARY_MAX_CHARS,
  extractArticleSummary,
} from '../../src/lib/article-summary-preview.js'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('article summary card preview', () => {
  it('extracts readable text from structured and legacy article bodies with a strict character bound', () => {
    const structured = JSON.stringify({
      version: 2,
      blocks: [
        { id: 'heading', type: 'heading', text: 'A useful heading', level: 2 },
        { id: 'paragraph', type: 'paragraph', text: 'The first paragraph of the article.' },
        { id: 'image', type: 'image', text: '', mediaRefs: ['https://luckread.com/image.jpg'] },
      ],
    })

    expect(extractArticleSummary(structured)).toBe('A useful heading The first paragraph of the article.')
    expect(extractArticleSummary('Legacy first paragraph.\n\nLegacy second paragraph.')).toBe(
      'Legacy first paragraph. Legacy second paragraph.',
    )
    const longText = 'a'.repeat(ARTICLE_SUMMARY_MAX_CHARS + 30)
    const excerpt = extractArticleSummary(longText)
    expect(excerpt).toHaveLength(ARTICLE_SUMMARY_MAX_CHARS)
    expect(excerpt?.endsWith('…')).toBe(true)
    expect(extractArticleSummary('  \n  ')).toBeNull()
  })

  it('routes social-token body reads through the W03/W07-authorized body endpoint', () => {
    const route = read('src/app/api/v1/contents/[contentId]/social/route.ts')
    const bodyRoute = read('src/app/api/v1/contents/[contentId]/body/route.ts')
    expect(route).toContain("import { GET as readAuthorizedContentBody } from '../body/route.js'")
    expect(route).toContain('await readAuthorizedContentBody(bodyRequest, {')
    expect(route).not.toContain('readTrustedArticleBodyForSocialTokens')
    expect(route).not.toContain('fetch(record.bodyRef)')
    expect(bodyRoute).toContain('await callW03Content(')
    expect(bodyRoute).toContain('isBodyAssetOwnedByContentOwner')
    expect(bodyRoute).toContain("'cache-control': 'private, no-store'")
  })

  it('adds the summary component to both home and discovery cards without replacing the content API', () => {
    const home = read('src/app/(frontend)/HomeContentFeed.tsx')
    const discovery = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const detail = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const api = read('src/app/api/v1/contents/route.ts')
    const w03 = read('../W03-content/src/index.ts')
    const component = read('src/components/ArticleSummaryPreview.tsx')
    const detailClient = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(home).toContain("import ArticleSummaryPreview from '../../components/ArticleSummaryPreview.js'")
    expect(home).toContain("item.contentType === 'article'")
    expect(home).toContain('bodyRef={item.bodyRef}')
    expect(discovery).toContain("import ArticleSummaryPreview from '../../../components/ArticleSummaryPreview.js'")
    expect(discovery).toContain("item.contentType === 'article'")
    expect(discovery).toContain('bodyRef={item.bodyRef}')
    expect(w03).toContain('bodyRef: item.bodyRef')
    expect(api).toContain('cachedPublicGet')
    expect(detail).toContain('<ContentDetailClient')
    expect(component).toContain("rootMargin: '320px 0px'")
    expect(component).toContain("credentials: 'include'")
    expect(component).toContain("cache: 'no-store'")
    expect(component).toContain("const url = `/api/v1/contents/\u0024{encodeURIComponent(contentId)}/body?preview=1`")
    expect(component).not.toContain('resolvePublicArticleBodyUrl(bodyRef, window.location.origin)')
    expect(component).toContain('apiFetch(url, {')
    expect(detailClient).toContain('/api/v1/contents/\u0024{encodeURIComponent(resolved.id)}/body')
    expect(detailClient).not.toContain('apiFetch(resolved.bodyRef, {')
    expect(component).toContain('className="content-feed-meta"')
    expect(component).toContain('className="content-detail-action-status"')
    expect(component).toContain('content-feed-skeleton-line')
    expect(component).not.toContain('ArticleSummaryPreview.module.css')
    expect(existsSync(resolve(process.cwd(), 'src/components/ArticleSummaryPreview.module.css'))).toBe(false)
    expect(component).not.toContain("fetch('/api/v1/contents?'")
    expect(home).toContain('/content/')
    expect(discovery).toContain('/content/')
  })

  it('keeps article summaries preview-only and leaves video content to the existing vertical player', () => {
    const component = read('src/components/ArticleSummaryPreview.tsx')
    const shorts = read('src/app/(frontend)/shorts/ShortVideoFeed.tsx')

    expect(component).not.toContain("method: 'POST'")
    expect(component).not.toContain("method: 'PATCH'")
    expect(shorts).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })")
    expect(shorts).toContain('showDoubleTapHeart')
    expect(shorts).toContain('playsInline')
    expect(shorts).toContain('relative h-dvh min-h-screen snap-start snap-always')
    expect(shorts).toContain('snap-y snap-mandatory')
  })
})
