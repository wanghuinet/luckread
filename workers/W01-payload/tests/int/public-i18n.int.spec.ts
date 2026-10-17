import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('public frontend i18n', () => {
  it('defines one shared locale resource for zh, en and tw', () => {
    const locale = read('src/app/(frontend)/i18n/public-locale.ts')

    expect(locale).toContain("export type PublicLocale = 'zh' | 'en' | 'tw'")
    expect(locale).toContain("value: 'zh'")
    expect(locale).toContain("value: 'en'")
    expect(locale).toContain("value: 'tw'")
    expect(locale).toContain("case 'en-US':")
    expect(locale).toContain("case 'zh-TW':")
  })

  it('keeps one shared language switch on the public reading routes after the clone landing migration', () => {
    const toggle = read('src/app/(frontend)/i18n/PublicLanguageToggle.tsx')
    const landing = read('src/app/(twitter-clone)/page.tsx')
    const landingView = read('src/app/(twitter-clone)/TwitterCloneLanding.tsx')
    const home = read('src/app/(twitter-clone)/home/page.tsx')
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
    const feed = read('src/app/(twitter-clone)/TwitterCloneHomeFeed.tsx')
    const cloneCopy = read('src/app/(twitter-clone)/twitter-clone-copy.ts')
    const browse = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const browseRoute = read('src/app/(twitter-clone)/content/page.tsx')
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const detailPage = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')

    expect(toggle).toContain('PUBLIC_LOCALES.map')
    expect(landing).toContain('normalizePublicLocale(localeCookie)')
    expect(landingView).toContain('<PublicLanguageToggle locale={locale} />')
    expect(landingView).toContain('copy.landing.happeningNow')
    expect(cloneCopy).toContain('zh: {')
    expect(cloneCopy).toContain('tw: {')
    expect(shell).toContain('<PublicLanguageToggle locale={locale} />')
    expect(home).toContain('<TwitterCloneHomeFeed key={feedMode} initialPage={initialPage} locale={locale} feedMode={feedMode} />')
    expect(feed).toContain('locale={locale}')
    expect(feed).not.toContain('locale="en"')
    expect(home).toContain('loadInitialContent(requestHeaders, locale)')
    expect(home).toContain("forwarded.set('accept-language', language)")
    expect(home).toContain("normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)")
    expect(browse).toContain('<TwitterCloneSecondaryPageLayout locale={locale} title={copy.content.title} active="explore">')
    expect(browseRoute).toContain("import ContentBrowsePage from '../../(frontend)/content/ContentBrowsePage'")
    expect(detail).toContain('<PublicLanguageToggle locale={locale} />')
    expect(detail).toContain('locale={locale}')
    expect(comments).toContain('getPublicCopy(locale)')
    expect(existsSync(resolve(process.cwd(), 'src/app/(frontend)/zh'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/app/(frontend)/en'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/app/(frontend)/tw'))).toBe(false)
  })

  it('keeps public content links on immutable slugs', () => {
    const browse = read('src/app/(frontend)/content/ContentBrowsePage.tsx')
    const feed = read('src/app/(frontend)/HomeContentFeed.tsx')
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const detailPage = read('src/app/(twitter-clone)/content/[contentId]/page.tsx')

    expect(browse).toContain("const href = '/content/' + encodeURIComponent(item.slug || item.id)")
    expect(browse).toContain('href={href}')
    expect(feed).toContain('href={`/content/${encodeURIComponent(item.slug || item.id)}`}')
    expect(feed).toContain("if (activeFeed === 'forYou' && hasInitialItems && retryKey === 0) return")
    expect(detail).toContain("fetchJson<Content>(`/api/v1/contents/${encodeURIComponent(contentId)}`")
    expect(detailPage).toContain('alternates:')
    expect(detailPage).toContain('permanentRedirect')
  })
})
