'use client'

import { useEffect, useId, useRef, useState } from 'react'

const LANGUAGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'es', label: 'Español' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'ru', label: 'Русский' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
  { value: 'bn', label: 'বাংলা' },
  { value: 'th', label: 'ไทย' },
  { value: 'vi', label: 'Tiếng Việt' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'fa', label: 'فارسی' },
  { value: 'uk', label: 'Українська' },
  { value: 'pl', label: 'Polski' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'sv', label: 'Svenska' },
  { value: 'no', label: 'Norsk' },
  { value: 'da', label: 'Dansk' },
  { value: 'fi', label: 'Suomi' },
  { value: 'el', label: 'Ελληνικά' },
  { value: 'fil', label: 'Filipino' },
  { value: 'sw', label: 'Kiswahili' },
  { value: 'he', label: 'עברית' },
]

function normalizeInitialLanguage(locale: string): string {
  if (locale === 'zh' || locale === 'zh-CN') return 'zh-CN'
  if (locale === 'tw' || locale === 'zh-TW') return 'zh-TW'
  if (locale === 'en-US') return 'en'
  return LANGUAGES.some((language) => language.value === locale) ? locale : 'zh-CN'
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

  // UI-only for now: selecting a language changes only this menu's local highlight.
  // Page translation, cookies, storage, and reload behavior are intentionally deferred.
  return (
    <div className="locale-globe-selector" ref={containerRef}>
      <button
        aria-label="选择语言 / Choose language"
        aria-expanded={open}
        aria-controls={menuId}
        className="locale-globe-trigger"
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
        <div aria-label="选择语言 / Choose language" className="locale-globe-menu" id={menuId} role="group">
          {LANGUAGES.map((language) => (
            <button
              aria-pressed={selectedLanguage === language.value}
              className={'locale-globe-option' + (selectedLanguage === language.value ? ' is-selected' : '')}
              key={language.value}
              onClick={() => {
                setSelectedLanguage(language.value)
                setOpen(false)
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
