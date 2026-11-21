'use client'

import GlobeLanguageMenu from '../i18n/GlobeLanguageMenu'

type StudioLocale = 'zh-CN' | 'en-US'

export default function CreatorLanguageToggle({ locale }: { locale: StudioLocale }) {
  return <GlobeLanguageMenu initialLocale={locale} />
}
