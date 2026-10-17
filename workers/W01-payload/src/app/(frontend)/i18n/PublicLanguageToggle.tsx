'use client'

import { useSyncExternalStore } from 'react'

import GlobeLanguageMenu from './GlobeLanguageMenu'
import { readPublicLocaleCookie, type PublicLocale } from './public-locale'

export const usePublicLocale = (): PublicLocale => useSyncExternalStore(
  () => () => undefined,
  readPublicLocaleCookie,
  () => 'zh',
)

export default function PublicLanguageToggle({ locale }: { locale: PublicLocale }) {
  return <GlobeLanguageMenu initialLocale={locale} />
}
