import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'

import { fetchJson } from '../../../../lib/client-api.js'

import ContentDetailClient from '../../../(frontend)/content/[contentId]/ContentDetailClient'
import { normalizePublicLocale } from '../../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

type ContentType = 'article' | 'post' | 'video'

type PublicContent = {
  id: string
  slug?: string
  creatorId?: string | null
  contentType: ContentType
  state: string
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

const PUBLIC_ORIGIN = 'https://luckread.com'

const getPublicContent = cache(async (contentId: string): Promise<PublicContent | null> => {
  const incoming = await headers()
  const requestHeaders = new Headers({
    accept: 'application/json',
  })
  const clientIp = incoming.get('cf-connecting-ip')?.trim()
  const language = incoming.get('accept-language')?.trim()
  if (clientIp) requestHeaders.set('cf-connecting-ip', clientIp)
  if (language) requestHeaders.set('accept-language', language)

  const request = new Request(
    'https://api.luckread.com/v1/contents/' + encodeURIComponent(contentId),
    { method: 'GET', headers: requestHeaders, cache: 'no-store' },
  )

  try {
    // Route through the canonical public W01 API. Rate limiting and shared
    // public caching stay owned by that API endpoint, not this page render.
    const { response, data } = await fetchJson<PublicContent>(request)
    if (!response.ok || !data || typeof data.id !== 'string') return null
    return data
  } catch {
    return null
  }
})

const canonicalUrl = (slugOrId: string): string =>
  PUBLIC_ORIGIN + '/content/' + encodeURIComponent(slugOrId)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ contentId: string }>
}): Promise<Metadata> {
  const { contentId } = await params
  const content = await getPublicContent(contentId)

  if (!content || content.state !== 'PUBLISHED') {
    return {
      title: '内容不存在 · LuckRead',
      robots: { index: false, follow: false },
    }
  }

  const canonical = canonicalUrl(content.slug || content.id)

  return {
    title: content.title ? content.title + ' · LuckRead' : 'LuckRead',
    description: content.title || 'LuckRead 内容',
    alternates: {
      canonical,
    },
    openGraph: {
      title: content.title || 'LuckRead',
      url: canonical,
      type: 'article',
    },
  }
}

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ contentId: string }>
}) {
  const { contentId } = await params
  const content = await getPublicContent(contentId)

  if (!content || content.state !== 'PUBLISHED') {
    notFound()
  }

  if (content.slug && content.slug !== contentId) {
    permanentRedirect('/content/' + encodeURIComponent(content.slug))
  }

  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  const pageTitle = content.contentType === 'article'
    ? (locale === 'en' ? 'Article' : locale === 'tw' ? '文章' : '文章')
    : content.contentType === 'video'
      ? (locale === 'en' ? 'Video' : locale === 'tw' ? '影片' : '视频')
      : (locale === 'en' ? 'Post' : locale === 'tw' ? '動態' : '动态')

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={pageTitle} active="explore">
      <ContentDetailClient
        initialContent={content}
        params={Promise.resolve({ contentId: content.slug || contentId })}
        showLanguageToggle={false}
      />
    </TwitterCloneSecondaryPageLayout>
  )
}
