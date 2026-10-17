import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ARTICLE_SUMMARY_MAX_CHARS,
  extractArticleSummary,
  resolvePublicArticleBodyUrl,
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

  it('allows only same-origin or LuckRead-hosted public body files', () => {
    expect(resolvePublicArticleBodyUrl('/api/v1/media/file/article.json', 'https://luckread.com'))
      .toBe('https://luckread.com/api/v1/media/file/article.json')
    expect(resolvePublicArticleBodyUrl('https://cdn.luckread.com/media/article.json', 'https://luckread.com'))
      .toBe('https://cdn.luckread.com/media/article.json')
    expect(resolvePublicArticleBodyUrl('https://untrusted.example/article.json', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('javascript:alert(1)', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('https://user:secret@luckread.com/article.json', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('http://luckread.com/article.json', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('http://localhost:3000/body.json', 'http://localhost:3000'))
      .toBe('http://localhost:3000/body.json')
  })

  it('adds the summary component to both home and discovery cards without replacing the content API', () => {
    const home = read('src/app/(frontend)/HomeContentFeed.tsx')
    const discovery = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const detail = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const api = read('src/app/api/v1/contents/route.ts')
    const w03 = read('../W03-content/src/index.ts')
    const component = read('src/components/ArticleSummaryPreview.tsx')

    expect(home).toContain("import ArticleSummaryPreview from '../../components/ArticleSummaryPreview.js'")
    expect(home).toContain("item.contentType === 'article'")
    expect(home).toContain('bodyRef={item.bodyRef}')
    expect(discovery).toContain("import ArticleSummaryPreview from '../../../components/ArticleSummaryPreview.js'")
    expect(discovery).toContain("item.contentType === 'article'")
    expect(discovery).toContain('bodyRef={item.bodyRef}')
    expect(w03).toContain('bodyRef: item.bodyRef')
    expect(api).toContain('cachedPublicGet')
    expect(detail).toContain('<ContentDetailClient')
    expect(component).toContain('rootMargin: \'320px 0px\'')
    expect(component).toContain("credentials: 'omit'")
    expect(component).toContain("referrerPolicy: 'no-referrer'")
    expect(component).toContain('resolvePublicArticleBodyUrl(bodyRef, window.location.origin)')
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
    const shortsCss = read('src/app/(frontend)/shorts/short-video.module.css')

    expect(component).not.toContain('method: \'POST\'')
    expect(component).not.toContain('method: \'PATCH\'')
    expect(shorts).toContain('scrollIntoView({ behavior: \'smooth\', block: \'start\' })')
    expect(shorts).toContain('showDoubleTapHeart')
    expect(shorts).toContain('playsInline')
    expect(shortsCss).toContain('height: 100dvh')
    expect(shortsCss).toContain('scroll-snap-type: y mandatory')
  })
})
