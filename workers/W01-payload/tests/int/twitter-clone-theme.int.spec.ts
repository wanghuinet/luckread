import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('Twitter Clone theme and document language preferences', () => {
  it('hydrates the selected theme and supported locale from request cookies', () => {
    const layout = read('src/app/(twitter-clone)/layout.tsx')

    expect(layout).toContain("cookieStore.get('luckread-ui-theme')?.value === 'light' ? 'light' : 'dark'")
    expect(layout).toContain("cookieStore.get('luckread-ui-locale')?.value")
    expect(layout).toContain("locale === 'en' ? 'en' : locale === 'tw' ? 'zh-TW' : 'zh-CN'")
    expect(layout).toContain("className={theme === 'dark' ? 'dark' : undefined}")
    expect(layout).not.toContain('className="dark" lang="en"')
  })

  it('provides an accessible persisted theme control and live theme tokens', () => {
    const toggle = read('src/app/(twitter-clone)/TwitterCloneThemeToggle.tsx')
    const styles = read('src/styles/twitter-clone-globals.scss')
    const shell = read('src/app/(twitter-clone)/TwitterCloneSecondaryPageLayout.tsx')
    const languageMenu = read('src/app/(frontend)/i18n/GlobeLanguageMenu.tsx')

    expect(toggle).toContain('aria-label={label}')
    expect(toggle).toContain('aria-pressed={theme === \'light\'}')
    expect(toggle).toContain("document.cookie = 'luckread-ui-theme=' + nextTheme")
    expect(toggle).toContain("root.classList.toggle('dark', nextTheme === 'dark')")
    expect(toggle).toContain("window.dispatchEvent(new Event('luckread-theme-change'))")
    expect(styles).toContain('html:not(.dark)')
    expect(styles).toContain('--main-background: var(--light-background)')
    expect(styles).toContain('--main-search-background: var(--light-search-background)')
    expect(styles).toContain('--main-sidebar-background: var(--light-sidebar-background)')
    expect(shell).toContain('<TwitterCloneThemeToggle locale={locale} />')
    expect(languageMenu).toContain("{ value: 'zh', label: '简体中文' }")
    expect(languageMenu).toContain("{ value: 'en', label: 'English' }")
    expect(languageMenu).toContain("{ value: 'tw', label: '繁體中文' }")
    expect(languageMenu).toContain("document.cookie = 'luckread-ui-locale=' + language.value")
    expect(languageMenu).toContain('window.location.reload()')
    expect(languageMenu).not.toContain("{ value: 'ja', label: '日本語' }")
  })
})
