'use client'

import { useEffect, useId, useRef, useState } from 'react'

const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'tw', label: '繁體中文' },
]

function normalizeInitialLanguage(locale: string): string {
  if (locale === 'zh-CN') return 'zh'
  if (locale === 'zh-TW') return 'tw'
  if (locale === 'en-US') return 'en'
  return LANGUAGES.some((language) => language.value === locale) ? locale : 'zh'
}

export default function GlobeLanguageMenu({ initialLocale = 'zh-CN' }: { initialLocale?: string }) {
  const [open, setOpen] = useState(false)
  const [selectedLanguage, setSelectedLanguage] = useState(() => normalizeInitialLanguage(initialLocale))
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // Persist only the three locales that the public Web interface currently translates.
  return (
    <div className="relative z-30 inline-flex shrink-0" ref={containerRef}>
      <button
        aria-label="选择语言 / Choose language"
        aria-expanded={open}
        aria-controls={menuId}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-light-border bg-transparent p-0 text-light-primary transition-colors hover:bg-light-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#878a8c] dark:border-dark-border dark:text-dark-primary dark:hover:bg-dark-primary/10 dark:focus-visible:ring-white max-[760px]:h-9 max-[760px]:w-9"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        title="选择语言 / Choose language"
        type="button"
      >
        <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
        </svg>
      </button>
      {open ? (
        <div aria-label="选择语言 / Choose language" className="absolute right-0 top-[calc(100%+8px)] z-[1000] grid max-h-[min(360px,calc(100vh-96px))] w-[min(320px,calc(100vw-24px))] grid-cols-2 gap-1 overflow-y-auto rounded-[14px] border border-[#e4e7ec] bg-white p-2 text-[#101828] shadow-[0_12px_32px_rgba(16,24,40,.16)] dark:border-[#38444d] dark:bg-[#15202b] dark:text-[#e7e9ea] max-[760px]:max-h-[min(320px,calc(100vh-80px))]" id={menuId} role="group">
          {LANGUAGES.map((language) => (
            <button
              aria-pressed={selectedLanguage === language.value}
              className={'min-h-[34px] min-w-0 cursor-pointer rounded-lg border-0 bg-transparent px-[9px] py-[7px] text-left text-xs leading-[1.3] text-[#344054] hover:bg-[#f2f4f7] hover:text-[#101828] focus-visible:bg-[#f2f4f7] focus-visible:text-[#101828] focus-visible:outline-none dark:text-[#e7e9ea] dark:hover:bg-[#253341] dark:hover:text-white dark:focus-visible:bg-[#253341] dark:focus-visible:text-white' + (selectedLanguage === language.value ? ' aria-pressed:bg-[#eef4ff] aria-pressed:text-[#1849a9] aria-pressed:font-bold dark:aria-pressed:bg-[#1d3b60] dark:aria-pressed:text-[#c6e2ff]' : '')}
              key={language.value}
              onClick={() => {
                setSelectedLanguage(language.value)
                setOpen(false)
                document.cookie = 'luckread-ui-locale=' + language.value + '; Path=/; Max-Age=31536000; SameSite=Lax' + (window.location.protocol === 'https:' ? '; Secure' : '')
                window.location.reload()
              }}
              type="button"
            >
              {language.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
