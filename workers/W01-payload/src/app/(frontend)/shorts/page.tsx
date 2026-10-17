import type { Metadata } from 'next'
import { cookies } from 'next/headers'

import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'
import { normalizePublicLocale, type PublicLocale } from '../i18n/public-locale'
import ShortVideoFeed from './ShortVideoFeed'

export const metadata: Metadata = {
  title: '短视频 · LuckRead',
  description: '全屏沉浸式短视频浏览。',
}

const titleFor = (locale: PublicLocale) => locale === 'en' ? 'Videos' : locale === 'tw' ? '影片' : '视频'

export const dynamic = 'force-dynamic'

export default async function ShortsPage() {
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  return <TwitterCloneSecondaryPageLayout locale={locale} title={titleFor(locale)} active="videos"><ShortVideoFeed /></TwitterCloneSecondaryPageLayout>
}
