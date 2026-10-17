import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import Link from 'next/link'
import { cachedPublicGet } from '../../../../lib/public-response-cache.js'
import { enforcePublicReadRateLimit } from '../../../../auth/traffic-limit.js'
import { callW05SocialPublic, W05SocialClientError } from '../../../../social/w05-social-client.js'
import { normalizePublicLocale, type PublicLocale } from '../../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

const PUBLIC_ORIGIN = 'https://luckread.com'

type TopicPageData = {
  topic: {
    topicId: string
    name: string
    displayName: string
    status: string
  }
  contents: Array<{
    id: string
    contentType: string
    title: string
    updatedAt: string
  }>
  hasMore: boolean
  nextCursor: string | null
}

async function getTopicPage(
  topicName: string,
  cursor: string | null,
): Promise<TopicPageData | null> {
  const incoming = await headers()
  const query = new URLSearchParams({ limit: '20' })
  if (cursor) query.set('cursor', cursor)

  const request = new Request(
    PUBLIC_ORIGIN + '/api/v1/topics/' + encodeURIComponent(topicName) + '?' + query.toString(),
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(incoming.get('cf-connecting-ip') ? { 'cf-connecting-ip': incoming.get('cf-connecting-ip')! } : {}),
        ...(incoming.get('accept-language') ? { 'accept-language': incoming.get('accept-language')! } : {}),
      },
    },
  )

  await enforcePublicReadRateLimit(request)

  try {
    const response = await cachedPublicGet(
      request,
      'social-topic-page',
      () => callW05SocialPublic({
        request,
        pathname: '/internal/social/topics/' + encodeURIComponent(topicName) + '?' + query.toString(),
        method: 'GET',
      }),
      30,
    )
    if (!response.ok) return null
    const payload = await response.json() as { data?: TopicPageData }
    return payload.data ?? null
  } catch (error) {
    if (error instanceof W05SocialClientError) return null
    throw error
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ topicName: string }>
}): Promise<Metadata> {
  const { topicName } = await params
  const topic = await getTopicPage(topicName, null)
  if (!topic) {
    return {
      title: '话题不存在 · LuckRead',
      robots: { index: false, follow: false },
    }
  }
  return {
    title: '#' + topic.topic.displayName + ' · LuckRead',
    description: 'LuckRead 话题：#' + topic.topic.displayName,
    alternates: {
      canonical: PUBLIC_ORIGIN + '/topics/' + encodeURIComponent(topic.topic.name),
    },
  }
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? { topic: 'Topic', restricted: 'Restricted topic', count: 'items on this page', empty: 'No public content yet.', notFound: 'Topic not found or temporarily unavailable.', back: 'Back to Explore', untitled: 'Untitled content', next: 'Next page', articles: 'Article', posts: 'Post', videos: 'Video' }
  : locale === 'tw'
    ? { topic: '話題', restricted: '受限話題', count: '條當前頁內容', empty: '暫無公開內容。', notFound: '話題不存在或暫時無法使用。', back: '返回探索', untitled: '未命名內容', next: '下一頁', articles: '文章', posts: '動態', videos: '影片' }
    : { topic: '话题', restricted: '受限话题', count: '条当前页内容', empty: '暂无公开内容。', notFound: '话题不存在或暂不可用。', back: '返回发现', untitled: '无标题内容', next: '下一页', articles: '文章', posts: '动态', videos: '视频' }

const dateLocale = (locale: PublicLocale) => locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ topicName: string }>
  searchParams: Promise<{ cursor?: string }>
}) {
  const { topicName } = await params
  const { cursor = null } = await searchParams
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  const labels = copy(locale)
  const topic = await getTopicPage(topicName, cursor)
  const title = topic ? '#' + topic.topic.displayName : '#' + topicName

  const nextHref = topic?.hasMore && topic.nextCursor
    ? '/topics/' + encodeURIComponent(topic.topic.name) + '?cursor=' + encodeURIComponent(topic.nextCursor)
    : null

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={title} active="explore">
      {!topic ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
          <p className="text-light-secondary dark:text-dark-secondary">{labels.notFound}</p>
          <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white" href="/content">{labels.back}</Link>
        </div>
      ) : (
        <>
          <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
            <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{topic.topic.status === 'ACTIVE' ? labels.topic : labels.restricted}</p>
            <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">{topic.contents.length} {labels.count}</p>
          </header>
          <section aria-label={'#' + topic.topic.displayName} className="flex flex-col">
            {topic.contents.length === 0 ? (
              <p className="border-b border-light-border px-4 py-6 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary">{labels.empty}</p>
            ) : (
              topic.contents.map((item) => (
                <article className="border-b border-light-border px-4 py-4 dark:border-dark-border" key={item.id}>
                  <Link className="main-tab block rounded-md transition hover:bg-white/5" href={'/content/' + encodeURIComponent(item.id)}>
                    <h2 className="text-base font-bold leading-6">{item.title || labels.untitled}</h2>
                  </Link>
                  <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
                    {item.contentType === 'article' ? labels.articles : item.contentType === 'video' ? labels.videos : labels.posts}
                    {' · '}
                    <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString(dateLocale(locale))}</time>
                  </p>
                </article>
              ))
            )}
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
