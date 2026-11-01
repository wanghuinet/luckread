import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  ARTICLE_BODY_FETCH_MAX_BYTES,
  ARTICLE_SUMMARY_MAX_CHARS,
  extractArticleSummary,
  readTrustedArticleBodyForSocialTokens,
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
    expect(resolvePublicArticleBodyUrl('https://img.luckread.com/media/article.json', 'https://luckread.com'))
      .toBe('https://img.luckread.com/media/article.json')
    expect(resolvePublicArticleBodyUrl('https://video.luckread.com/media/article-body.mp4', 'https://luckread.com'))
      .toBe('https://video.luckread.com/media/article-body.mp4')
    expect(resolvePublicArticleBodyUrl('https://untrusted.example/article.json', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('javascript:alert(1)', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('https://user:secret@luckread.com/article.json', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('http://luckread.com/article.json', 'https://luckread.com')).toBeNull()
    expect(resolvePublicArticleBodyUrl('http://localhost:3000/body.json', 'http://localhost:3000'))
      .toBe('http://localhost:3000/body.json')
  })

  it('reads bounded body text only through a trusted host and does not follow redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('Hello @alice #topics', {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'content-length': '20' },
    }))
    await expect(readTrustedArticleBodyForSocialTokens(
      'https://img.luckread.com/media/body.txt',
      'https://api.luckread.com',
      fetcher,
    )).resolves.toBe('Hello @alice #topics')

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://img.luckread.com/media/body.txt', expect.objectContaining({
      method: 'GET',
      headers: { accept: 'text/plain' },
      redirect: 'manual',
    }))
  })

  it('does not fetch an untrusted body reference', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(readTrustedArticleBodyForSocialTokens(
      'https://attacker.example/redirect',
      'https://api.luckread.com',
      fetcher,
    )).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects redirects and rejects bodies larger than the byte budget', async () => {
    const redirected = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', {
      status: 302,
      headers: { location: 'https://attacker.example/collect' },
    }))
    await expect(readTrustedArticleBodyForSocialTokens(
      'https://img.luckread.com/media/body.txt',
      'https://api.luckread.com',
      redirected,
    )).resolves.toBeNull()
    expect(redirected).toHaveBeenCalledTimes(1)

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(ARTICLE_BODY_FETCH_MAX_BYTES + 1))
        controller.close()
      },
    })
    const oversized = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(oversizedStream, { status: 200 }))
    await expect(readTrustedArticleBodyForSocialTokens(
      'https://img.luckread.com/media/body.txt',
      'https://api.luckread.com',
      oversized,
    )).resolves.toBeNull()
  })

  it('routes social-token body reads through the bounded trusted-reference reader', () => {
    const route = read('src/app/api/v1/contents/[contentId]/social/route.ts')
    expect(route).toContain('readTrustedArticleBodyForSocialTokens')
    expect(route).not.toContain('fetch(record.bodyRef)')
  })

  it('adds the summary component to discovery cards without replacing the content API', () => {
    const discovery = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const detail = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const sharedRoutes = read('src/app/(frontend)/content/PublicContentRoutes.tsx')
    const publicUrlHelper = read('src/lib/public-content-url.ts')
    const api = read('src/app/api/v1/contents/route.ts')
    const w03 = read('../W03-content/src/index.ts')
    const component = read('src/components/ArticleSummaryPreview.tsx')
    const detailClient = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')

    expect(discovery).toContain("import ArticleSummaryPreview from '../../../components/ArticleSummaryPreview.js'")
    expect(discovery).toContain("item.contentType === 'article'")
    expect(discovery).toContain('bodyRef={item.bodyRef}')
    expect(w03).toContain('bodyRef: item.bodyRef')
    expect(api).toContain('cachedPublicGet')
    expect(detail).toContain('renderLegacyContentRoute(contentId)')
    expect(sharedRoutes).toContain('<ContentDetailClient')
    expect(publicUrlHelper).toContain("if (!username) return '/content/' + encodeURIComponent(content.slug || id)")
    expect(component).toContain("rootMargin: '320px 0px'")
    expect(component).toContain("credentials: 'omit'")
    expect(component).toContain("referrerPolicy: 'no-referrer'")
    expect(component).toContain('resolvePublicArticleBodyUrl(bodyRef, window.location.origin)')
    expect(component).toContain('apiFetch(url, {')
    expect(detailClient).toContain('apiFetch(resolved.bodyRef, {')
    expect(component).toContain('className="content-feed-meta"')
    expect(component).toContain('className="content-detail-action-status"')
    expect(component).toContain('content-feed-skeleton-line')
    expect(component).not.toContain('ArticleSummaryPreview.module.css')
    expect(existsSync(resolve(process.cwd(), 'src/components/ArticleSummaryPreview.module.css'))).toBe(false)
    expect(component).not.toContain("fetch('/api/v1/contents?'")
    expect(discovery).toContain('buildPublicContentHref(item)')
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
