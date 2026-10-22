import { cookies } from 'next/headers'

import { normalizePublicLocale } from '../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../TwitterCloneSecondaryPageLayout'
import SearchDiscoveryClient from './SearchDiscoveryClient'

export const dynamic = 'force-dynamic'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const params = await searchParams
  const value = typeof params.q === 'string' ? params.q.normalize('NFKC').trim() : ''
  const initialQuery = value.length <= 256 ? value : ''
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  const title = locale === 'en' ? 'Search' : locale === 'tw' ? '搜尋' : '搜索'

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={title} active="search">
      <SearchDiscoveryClient key={initialQuery} locale={locale} initialQuery={initialQuery} />
    </TwitterCloneSecondaryPageLayout>
  )
}
