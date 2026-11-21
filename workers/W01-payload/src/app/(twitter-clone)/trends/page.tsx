import { cookies, headers } from 'next/headers'
import Link from 'next/link'

import { fetchJson } from '../../../lib/client-api.js'
import { normalizePublicLocale, type PublicLocale } from '../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../TwitterCloneSecondaryPageLayout'

const PUBLIC_API_ORIGIN = 'https://api.luckread.com'

type DiscoveryTopicPageData = {
  items: Array<{
    topicId: string
    name: string
    displayName: string
    contentCount: number
    latestContentAt: string
  }>
  hasMore: boolean
  nextCursor: string | null
}

async function getDiscoveryTopics(cursor: string | null): Promise<DiscoveryTopicPageData | null> {
  const incoming = await headers()
  const query = new URLSearchParams({ limit: '20' })
  if (cursor) query.set('cursor', cursor)

  const request = new Request(PUBLIC_API_ORIGIN + '/v1/discovery/topics?' + query.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(incoming.get('cf-connecting-ip') ? { 'cf-connecting-ip': incoming.get('cf-connecting-ip')! } : {}),
      ...(incoming.get('accept-language') ? { 'accept-language': incoming.get('accept-language')! } : {}),
    },
    cache: 'no-store',
  })

  try {
    // Let the canonical W01 public API own rate limiting and the shared cache.
    const { response, data: payload } = await fetchJson<{ data?: DiscoveryTopicPageData }>(request)
    if (!response.ok) return null
    const data = payload?.data
    if (
      !data ||
      !Array.isArray(data.items) ||
      typeof data.hasMore !== 'boolean' ||
      (data.nextCursor !== null && typeof data.nextCursor !== 'string')
    ) return null
    return data
  } catch {
    return null
  }
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Trending topics',
      subtitle: 'Topics attached to public content updated in the last 7 days.',
      count: 'recent public items',
      latest: 'Latest activity',
      empty: 'No trending topics yet.',
      unavailable: 'Trending topics are temporarily unavailable.',
      retryExplore: 'Back to Explore',
      next: 'Next page',
      previous: 'Explore content',
    }
  : locale === 'tw'
    ? {
        title: '熱門話題',
        subtitle: '依據近 7 天有更新的公開內容整理。',
        count: '條近期公開內容',
        latest: '最近活動',
        empty: '目前還沒有熱門話題。',
        unavailable: '熱門話題暫時無法使用。',
        retryExplore: '返回探索',
        next: '下一頁',
        previous: '探索內容',
      }
    : {
        title: '热门话题',
        subtitle: '根据最近 7 天有更新的公开内容整理。',
        count: '条近期公开内容',
        latest: '最近活动',
        empty: '暂时还没有热门话题。',
        unavailable: '热门话题暂时无法使用。',
        retryExplore: '返回发现',
        next: '下一页',
        previous: '浏览内容',
      }

const dateLocale = (locale: PublicLocale) => locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>
}) {
  const { cursor = null } = await searchParams
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  const labels = copy(locale)
  const topics = await getDiscoveryTopics(cursor)

  const nextHref = topics?.hasMore && topics.nextCursor
    ? '/trends?cursor=' + encodeURIComponent(topics.nextCursor)
    : null

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="trends">
      <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
        <p className="text-xs font-bold uppercase tracking-widest text-main-accent">LUCKREAD DISCOVERY</p>
        <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.subtitle}</p>
      </header>
      {!topics ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
          <p className="text-light-secondary dark:text-dark-secondary">{labels.unavailable}</p>
          <Link className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href="/content">{labels.retryExplore}</Link>
        </div>
      ) : topics.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
          <p className="text-light-secondary dark:text-dark-secondary">{labels.empty}</p>
          <Link className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href="/content">{labels.previous}</Link>
        </div>
      ) : (
        <>
          <section aria-label={labels.title} className="flex flex-col">
            {topics.items.map((topic, index) => (
              <article key={topic.topicId} className="border-b border-light-border px-4 py-4 transition hover:bg-white/5 dark:border-dark-border">
                <Link className="block rounded-md" href={'/topics/' + encodeURIComponent(topic.name)}>
                  <p className="text-xs text-light-secondary dark:text-dark-secondary">
                    {index + 1}. {labels.latest}
                  </p>
                  <h2 className="mt-1 text-base font-bold">#{topic.displayName}</h2>
                  <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
                    {topic.contentCount} {labels.count}
                  </p>
                  <time className="mt-1 block text-xs text-light-secondary dark:text-dark-secondary" dateTime={topic.latestContentAt}>
                    {new Date(topic.latestContentAt).toLocaleString(dateLocale(locale))}
                  </time>
                </Link>
              </article>
            ))}
          </section>
          {nextHref ? (
            <nav aria-label={labels.next} className="flex justify-center px-4 py-5">
              <Link className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={nextHref}>{labels.next}</Link>
            </nav>
          ) : null}
        </>
      )}
    </TwitterCloneSecondaryPageLayout>
  )
}
