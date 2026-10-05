'use client'

import { useMemo, useState } from 'react'

type StudioLocale = 'zh-CN' | 'en-US'

const COOKIE_NAME = 'luckread-ui-locale'

export default function CreatorLanguageToggle({ locale }: { locale: StudioLocale }) {
  const [pending, setPending] = useState(false)

  const labels = useMemo(
    () =>
      locale === 'en-US'
        ? { aria: 'Interface language', zh: '中文', en: 'English' }
        : { aria: '界面语言', zh: '中文', en: 'English' },
    [locale],
  )

  const switchLocale = (nextLocale: StudioLocale) => {
    if (nextLocale === locale || pending) return
    setPending(true)
    document.cookie = COOKIE_NAME + '=' + nextLocale + '; Path=/; Max-Age=31536000; SameSite=Lax'
    window.location.reload()
  }

  return (
    <div className="languageSwitch" role="group" aria-label={labels.aria}>
      <button
        className={'languageSwitchButton' + (locale === 'zh-CN' ? ' languageSwitchButtonActive' : '')}
        type="button"
        aria-pressed={locale === 'zh-CN'}
        onClick={() => switchLocale('zh-CN')}
        disabled={pending}
      >
        {labels.zh}
      </button>
      <button
        className={'languageSwitchButton' + (locale === 'en-US' ? ' languageSwitchButtonActive' : '')}
        type="button"
        aria-pressed={locale === 'en-US'}
        onClick={() => switchLocale('en-US')}
        disabled={pending}
      >
        {labels.en}
      </button>
    </div>
  )
}
