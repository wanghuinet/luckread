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

  it('keeps public reader locale support while using the cloned default landing', () => {
    const toggle = read('src/app/(frontend)/i18n/PublicLanguageToggle.tsx')
    const landing = read('src/app/(twitter-clone)/TwitterCloneLanding.tsx')
    const creatorHome = read('src/app/(twitter-clone)/CreatorDomainHome.tsx')
    const browse = read('src/app/(frontend)/content/page.tsx')
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const comments = read('src/app/(frontend)/content/[contentId]/ContentComments.tsx')

    expect(toggle).toContain('PUBLIC_LOCALES.map')
    expect(landing).toContain('href="/register"')
    expect(landing).toContain('href="/login"')
    expect(creatorHome).toContain("luckread-ui-locale")
    expect(creatorHome).toContain('<CreatorLanguageToggle locale={locale} />')
    expect(browse).toContain('<PublicLanguageToggle locale={locale} />')
    expect(detail).toContain('<PublicLanguageToggle locale={locale} />')
    expect(detail).toContain('locale={locale}')
    expect(comments).toContain('getPublicCopy(locale)')
    expect(existsSync(resolve(process.cwd(), 'src/app/(frontend)/zh'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/app/(frontend)/en'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/app/(frontend)/tw'))).toBe(false)
  })

  it('keeps public content links on immutable slugs', () => {
    const browse = read('src/app/(frontend)/content/page.tsx')
    const feed = read('src/app/(frontend)/HomeContentFeed.tsx')
    const detail = read('src/app/(frontend)/content/[contentId]/ContentDetailClient.tsx')
    const detailPage = read('src/app/(frontend)/content/[contentId]/page.tsx')

    expect(browse).toContain("href={'/content/' + encodeURIComponent(item.slug || item.id)}")
    expect(feed).toContain('href={`/content/${encodeURIComponent(item.slug || item.id)}`}')
    expect(feed).toContain('if (hasInitialItems && retryKey === 0) return')
    expect(detail).toContain("fetchJson<Content>(`/api/v1/contents/${encodeURIComponent(contentId)}`")
    expect(detailPage).toContain('alternates:')
    expect(detailPage).toContain('permanentRedirect')
  })
})
