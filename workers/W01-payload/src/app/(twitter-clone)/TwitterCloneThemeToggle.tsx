'use client'

import { useSyncExternalStore } from 'react'
import type { PublicLocale } from '../(frontend)/i18n/public-locale'

type Theme = 'light' | 'dark'

const subscribe = (callback: () => void) => {
  window.addEventListener('luckread-theme-change', callback)
  return () => window.removeEventListener('luckread-theme-change', callback)
}

const getSnapshot = (): Theme => document.documentElement.classList.contains('dark') ? 'dark' : 'light'
const getServerSnapshot = (): Theme => 'dark'

export default function TwitterCloneThemeToggle({ locale }: { locale: PublicLocale }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark'
  const labels = {
    zh: { light: '切换到浅色模式', dark: '切换到深色模式' },
    tw: { light: '切換至淺色模式', dark: '切換至深色模式' },
    en: { light: 'Switch to light mode', dark: 'Switch to dark mode' },
  }
  const label = labels[locale][nextTheme]

  return (
    <button
      aria-label={label}
      aria-pressed={theme === 'light'}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-light-border bg-transparent text-light-primary transition-colors hover:bg-light-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#878a8c] dark:border-dark-border dark:text-dark-primary dark:hover:bg-dark-primary/10 dark:focus-visible:ring-white"
      data-testid="theme-toggle"
      onClick={() => {
        const root = document.documentElement
        root.classList.toggle('dark', nextTheme === 'dark')
        document.cookie = 'luckread-ui-theme=' + nextTheme + '; Path=/; Max-Age=31536000; SameSite=Lax' + (window.location.protocol === 'https:' ? '; Secure' : '')
        window.dispatchEvent(new Event('luckread-theme-change'))
      }}
      title={label}
      type="button"
    >
      {nextTheme === 'light' ? (
        <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
        </svg>
      ) : (
        <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        </svg>
      )}
    </button>
  )
}
