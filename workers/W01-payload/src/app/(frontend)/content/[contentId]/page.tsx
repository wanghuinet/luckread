import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'

import { enforcePublicReadRateLimit } from '../../../../auth/traffic-limit.js'
import { callW03Content, W03ContentClientError } from '../../../../content/w03-content-client.js'
import { cachedPublicGet } from '../../../../lib/public-response-cache.js'

import ContentDetailClient from './ContentDetailClient'

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
    PUBLIC_ORIGIN + '/api/v1/contents/' + encodeURIComponent(contentId),
    { method: 'GET', headers: requestHeaders },
  )

  await enforcePublicReadRateLimit(request)

  try {
    const response = await cachedPublicGet(
      request,
      'content-detail',
      () => callW03Content({
        request,
        pathname: '/internal/content/contents/' + encodeURIComponent(contentId),
        method: 'GET',
      }),
      30,
    )

    if (!response.ok) return null
    return await response.json() as PublicContent
  } catch (error) {
    if (error instanceof W03ContentClientError) return null
    throw error
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

  return <ContentDetailClient params={Promise.resolve({ contentId: content.slug || contentId })} />
}
