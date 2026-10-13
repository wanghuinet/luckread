import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { cachedPublicGet } from '../../../../lib/public-response-cache.js'
import { enforcePublicReadRateLimit } from '../../../../auth/traffic-limit.js'
import { callW05SocialPublic, W05SocialClientError } from '../../../../social/w05-social-client.js'

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

export default async function TopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ topicName: string }>
  searchParams: Promise<{ cursor?: string }>
}) {
  const { topicName } = await params
  const { cursor = null } = await searchParams
  const topic = await getTopicPage(topicName, cursor)
  if (!topic) {
    return (
      <main className="content-detail">
        <div className="content-detail-state">
          <p>话题不存在或暂不可用。</p>
          <Link href="/">返回首页</Link>
        </div>
      </main>
    )
  }

  const nextHref = topic.hasMore && topic.nextCursor
    ? '/topics/' + encodeURIComponent(topic.topic.name) + '?cursor=' + encodeURIComponent(topic.nextCursor)
    : null

  return (
    <main className="content-detail">
      <header>
        <p>{topic.topic.status === 'ACTIVE' ? '话题' : '受限话题'}</p>
        <h1>#{topic.topic.displayName}</h1>
        <p>{topic.contents.length} 条当前页内容</p>
      </header>
      <section aria-label={'#' + topic.topic.displayName}>
        {topic.contents.length === 0 ? (
          <p>暂无公开内容。</p>
        ) : (
          <div>
            {topic.contents.map((item) => (
              <article key={item.id}>
                <Link href={'/content/' + encodeURIComponent(item.id)}>
                  <h2>{item.title || '无标题内容'}</h2>
                </Link>
                <p>{item.contentType} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      {nextHref ? (
        <nav aria-label="话题分页">
          <Link href={nextHref}>下一页</Link>
        </nav>
      ) : null}
    </main>
  )
}
