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
  ownerUserId?: string | null
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

const uuidFromStableContentSlug = (slug: string): string | null => {
  const compactUuid = /-([0-9a-f]{32})$/i.exec(slug)?.[1]
  if (
    !compactUuid ||
    !/^[0-9a-f]{8}[0-9a-f]{4}[1-8][0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i.test(compactUuid)
  ) {
    return null
  }

  return compactUuid.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

const fetchPublicContent = async (contentId: string, requestHeaders: Headers) => {
  const request = new Request(
    'https://api.luckread.com/v1/contents/' + encodeURIComponent(contentId),
    { method: 'GET', headers: requestHeaders, cache: 'no-store' },
  )
  return fetchJson<PublicContent>(request)
}

const getPublicContent = cache(async (contentId: string): Promise<PublicContent | null> => {
  const incoming = await headers()
  const requestHeaders = new Headers({
    accept: 'application/json',
  })
  const clientIp = incoming.get('cf-connecting-ip')?.trim()
  const language = incoming.get('accept-language')?.trim()
  if (clientIp) requestHeaders.set('cf-connecting-ip', clientIp)
  if (language) requestHeaders.set('accept-language', language)

  try {
    // Route through the canonical public W01 API. Rate limiting and shared
    // public caching stay owned by that API endpoint, not this page render.
    let result = await fetchPublicContent(contentId, requestHeaders)

    // Older UUID-backed records may have a valid ID suffix in their public
    // slug while their stored slug index is out of sync. Retry only a 404 by
    // the encoded UUID; W03 still applies its normal public-visibility checks.
    if (result.response.status === 404) {
      const fallbackId = uuidFromStableContentSlug(contentId)
      if (fallbackId) {
        result = await fetchPublicContent(fallbackId, requestHeaders)
      }
    }

    if (!result.response.ok || !result.data || typeof result.data.id !== 'string') return null
    return result.data
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
