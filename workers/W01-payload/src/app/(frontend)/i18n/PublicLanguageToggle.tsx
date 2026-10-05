'use client'

import { useState } from 'react'

import {
  PUBLIC_LOCALES,
  setPublicLocaleCookie,
  type PublicLocale,
} from './public-locale'

export default function PublicLanguageToggle({ locale }: { locale: PublicLocale }) {
  const [pending, setPending] = useState(false)

  function switchLocale(nextLocale: PublicLocale) {
    if (nextLocale === locale || pending) return
    setPending(true)
    setPublicLocaleCookie(nextLocale)
    window.location.reload()
  }

  return (
    <div className="public-language-switch" role="group" aria-label={locale === 'en' ? 'Interface language' : '介面語言'}>
      {PUBLIC_LOCALES.map((option) => (
        <button
          className={option.value === locale ? 'public-language-button active' : 'public-language-button'}
          disabled={pending}
          key={option.value}
          type="button"
          aria-pressed={option.value === locale}
          onClick={() => switchLocale(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
