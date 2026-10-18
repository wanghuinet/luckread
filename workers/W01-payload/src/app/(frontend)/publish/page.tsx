import { cookies } from 'next/headers'

import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'
import { normalizePublicLocale } from '../i18n/public-locale'
import PublishComposer from './PublishComposer'
import './publish.css'

type ContentType = 'article' | 'post' | 'video'

function normalizeContentType(value: string | string[] | undefined): ContentType {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === 'post' || candidate === 'video' ? candidate : 'article'
}

export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string | string[]; draft?: string | string[] }>
}) {
  const params = await searchParams
  const initialType = normalizeContentType(params.type)
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  const title = locale === 'en' ? 'Create content' : locale === 'tw' ? '發布內容' : '发布内容'
  const description = locale === 'en'
    ? 'Publish articles, posts, and videos through LuckRead.'
    : locale === 'tw'
      ? '透過 LuckRead 發布文章、動態和影片。'
      : '通过 LuckRead 发布文章、动态和视频。'

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={title} active="editProfile">
      <section className="border-b border-light-border px-4 py-4 dark:border-dark-border">
        <p className="text-sm text-light-secondary dark:text-dark-secondary">{description}</p>
      </section>
      <PublishComposer initialType={initialType} presentation="x-workspace" />
    </TwitterCloneSecondaryPageLayout>
  )
}
