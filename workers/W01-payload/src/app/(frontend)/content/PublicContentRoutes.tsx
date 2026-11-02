import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { cache } from 'react'

import { getPublicContentAuthorContextResponse, getPublicContentDetailResponse } from '../../../content/public-content-detail-reader.js'
import { getPublicUserProfileResponse } from '../../../users/public-user-profile-reader.js'
import ContentDetailClient from './[contentId]/ContentDetailClient'
import { normalizePublicLocale } from '../i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'
import type { PublicContentRouteType } from '../../../lib/public-content-url.js'

type PublicAuthor = {
  id: string
  identityId?: string | null
  username?: string | null
  displayName?: string | null
  avatar?: string | null
}

type PublicContent = {
  id: string
  slug?: string
  creatorId?: string | null
  ownerUserId?: string | null
  creator?: { id?: string; userId?: string; username?: string; displayName?: string | null; avatar?: string | null } | null
  author?: { id?: string; userId?: string; username?: string; displayName?: string | null; avatar?: string | null } | null
  contentType: 'article' | 'post' | 'video'
  state: string
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

type ContentBundle = {
  content: PublicContent | null
  author: PublicAuthor | null
}

const requestHeaders = async (): Promise<Headers> => {
  const incoming = await headers()
  const outgoing = new Headers({ accept: 'application/json' })
  const clientIp = incoming.get('cf-connecting-ip')?.trim()
  const language = incoming.get('accept-language')?.trim()
  if (clientIp) outgoing.set('cf-connecting-ip', clientIp)
  if (language) outgoing.set('accept-language', language)
  return outgoing
}

const uuidFromStableContentSlug = (slug: string): string | null => {
  const compactUuid = /-([0-9a-f]{32})$/i.exec(slug)?.[1]
  if (
    !compactUuid ||
    !/^[0-9a-f]{8}[0-9a-f]{4}[1-8][0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i.test(compactUuid)
  ) return null

  return compactUuid.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
}

const fetchContentById = async (contentId: string, headersForRequest: Headers) =>
  getPublicContentDetailResponse(
    new Request('https://luckread.com/api/v1/contents/' + encodeURIComponent(contentId), {
      method: 'GET',
      headers: headersForRequest,
      cache: 'no-store',
    }),
    contentId,
  )

const getPublicContentOwnerId = cache(async (contentId: string): Promise<string | null> => {
  const response = await getPublicContentAuthorContextResponse(
    new Request('https://luckread.com/api/v1/contents/' + encodeURIComponent(contentId) + '/public-author-context', {
      method: 'GET',
      headers: await requestHeaders(),
      cache: 'no-store',
    }),
    contentId,
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error('PUBLIC_CONTENT_AUTHOR_CONTEXT_READ_FAILED:' + response.status)
  }

  const value: unknown = await response.json().catch((): null => null)
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { data?: unknown }).data
    : null
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('PUBLIC_CONTENT_AUTHOR_CONTEXT_RESPONSE_INVALID')
  }
  const context = data as { contentId?: unknown; ownerUserId?: unknown }
  if (context.contentId !== contentId ||
      typeof context.ownerUserId !== 'string' ||
      !context.ownerUserId.trim()) {
    throw new Error('PUBLIC_CONTENT_AUTHOR_CONTEXT_RESPONSE_INVALID')
  }
  return context.ownerUserId
})

const readPublicContentResponse = async (response: Response): Promise<PublicContent | null> => {
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error('PUBLIC_CONTENT_READ_FAILED:' + response.status)
  }

  const value: unknown = await response.json().catch((): null => null)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PUBLIC_CONTENT_RESPONSE_INVALID')
  }
  const content = value as { id?: unknown; state?: unknown; contentType?: unknown; title?: unknown }
  if (
    typeof content.id !== 'string' ||
    typeof content.state !== 'string' ||
    !['article', 'post', 'video'].includes(String(content.contentType)) ||
    typeof content.title !== 'string'
  ) {
    throw new Error('PUBLIC_CONTENT_RESPONSE_INVALID')
  }
  return value as PublicContent
}

const getPublicContent = cache(async (contentId: string): Promise<PublicContent | null> => {
  const headersForRequest = await requestHeaders()
  let response = await fetchContentById(contentId, headersForRequest)
  let content = await readPublicContentResponse(response)

  if (!content && response.status === 404) {
    const fallbackId = uuidFromStableContentSlug(contentId)
    if (fallbackId) {
      response = await fetchContentById(fallbackId, headersForRequest)
      content = await readPublicContentResponse(response)
    }
  }

  return content
})

const getPublicAuthorById = cache(async (userId: string): Promise<PublicAuthor | null> => {
  const normalized = userId.trim()
  if (!normalized || normalized.length > 128) {
    throw new Error('PUBLIC_AUTHOR_ID_INVALID')
  }

  const response = await getPublicUserProfileResponse(
    new Request('https://luckread.com/api/v1/users/' + encodeURIComponent(normalized), {
      method: 'GET',
      headers: await requestHeaders(),
      cache: 'no-store',
    }),
    normalized,
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error('PUBLIC_AUTHOR_READ_FAILED:' + response.status)
  }

  const value: unknown = await response.json().catch((): null => null)
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof (value as { username?: unknown }).username !== 'string' ||
      !(value as { username: string }).username.trim()) {
    throw new Error('PUBLIC_AUTHOR_RESPONSE_INVALID')
  }
  return value as PublicAuthor
})

const getContentBundle = cache(async (contentId: string): Promise<ContentBundle> => {
  const content = await getPublicContent(contentId)
  if (!content) return { content: null, author: null }

  // W03, not Creator identity data or a stale Payload projection, is the
  // authority for the owner of a published content record.
  const ownerUserId = await getPublicContentOwnerId(content.id)
  if (!ownerUserId) return { content, author: null }

  const author = await getPublicAuthorById(ownerUserId)
  return { content, author }
})

const routeTypeForContent = (content: PublicContent, requested?: PublicContentRouteType): PublicContentRouteType => {
  if (content.contentType === 'article') return 'article'
  if (content.contentType === 'post') return 'post'
  return requested === 'short' ? 'short' : 'video'
}

const canonicalPath = (
  author: PublicAuthor,
  content: PublicContent,
  requested?: PublicContentRouteType,
): string => {
  const username = (author.username || '').trim().replace(/^@+/, '')
  const segment = routeTypeForContent(content, requested)
  return '/@' + encodeURIComponent(username) + '/' + segment + '/' + encodeURIComponent(content.id)
}

const pageTitle = (content: PublicContent, locale: 'zh' | 'tw' | 'en'): string => {
  if (content.contentType === 'article') return locale === 'en' ? 'Article' : '文章'
  if (content.contentType === 'video') return locale === 'en' ? 'Video' : locale === 'tw' ? '影片' : '视频'
  return locale === 'en' ? 'Post' : locale === 'tw' ? '動態' : '动态'
}

const contentMetadata = (
  content: PublicContent,
  canonical: string,
): Metadata => ({
  title: content.title ? content.title + ' · LuckRead' : 'LuckRead',
  description: content.title || 'LuckRead 内容',
  alternates: { canonical: 'https://luckread.com' + canonical },
  openGraph: {
    title: content.title || 'LuckRead',
    url: 'https://luckread.com' + canonical,
    type: content.contentType === 'video' ? 'website' : 'article',
  },
})

const missingMetadata = (): Metadata => ({
  title: '内容不存在 · LuckRead',
  robots: { index: false, follow: false },
})

export async function generateCanonicalContentMetadata(input: {
  username: string
  contentId: string
  routeType: PublicContentRouteType
}): Promise<Metadata> {
  const { content, author } = await getContentBundle(input.contentId)
  if (!content || content.state !== 'PUBLISHED') return missingMetadata()
  const canonical = author?.username
    ? canonicalPath(author, content, input.routeType)
    : '/content/' + encodeURIComponent(content.slug || content.id)
  return contentMetadata(content, canonical)
}

export async function renderCanonicalContentRoute(input: {
  username: string
  contentId: string
  routeType: PublicContentRouteType
}) {
  const { content, author } = await getContentBundle(input.contentId)
  if (!content || content.state !== 'PUBLISHED' || !author?.username) notFound()

  let decodedRequestedUsername = input.username.trim()
  try {
    decodedRequestedUsername = decodeURIComponent(decodedRequestedUsername)
  } catch {
    // Keep the raw segment; it will fail the username comparison and be
    // redirected to the owner-resolved canonical path below.
  }
  const requestedUsername = decodedRequestedUsername.replace(/^@+/, '')
  const canonicalUsername = author.username.trim().replace(/^@+/, '')
  const canonicalRouteType = routeTypeForContent(content, input.routeType)

  // A valid canonical URL never redirects. When an old handle, encoded handle,
  // or incorrect content-type segment reaches this route, correct it using
  // W03's authoritative content owner instead of returning a misleading 404.
  // Use a temporary redirect so a later username change cannot leave a stale
  // permanent redirect cached at the edge.
  if (
    !requestedUsername ||
    requestedUsername.toLowerCase() !== canonicalUsername.toLowerCase() ||
    canonicalRouteType !== input.routeType
  ) {
    redirect(canonicalPath(author, content, input.routeType))
  }

  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={pageTitle(content, locale)} active="explore">
      <ContentDetailClient
        initialContent={content}
        params={Promise.resolve({ contentId: content.id })}
        showLanguageToggle={false}
      />
    </TwitterCloneSecondaryPageLayout>
  )
}

export async function generateLegacyContentMetadata(contentId: string): Promise<Metadata> {
  const { content, author } = await getContentBundle(contentId)
  if (!content || content.state !== 'PUBLISHED') return missingMetadata()
  const canonical = author?.username
    ? canonicalPath(author, content)
    : '/content/' + encodeURIComponent(content.slug || content.id)
  return contentMetadata(content, canonical)
}

export async function renderLegacyContentRoute(contentId: string) {
  const { content, author } = await getContentBundle(contentId)
  if (!content || content.state !== 'PUBLISHED') notFound()
  if (author?.username) permanentRedirect(canonicalPath(author, content))

  // Keep the legacy URL readable during migration if an older content record
  // does not yet have a resolvable public author projection.
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={pageTitle(content, locale)} active="explore">
      <ContentDetailClient
        initialContent={content}
        params={Promise.resolve({ contentId: content.id })}
        showLanguageToggle={false}
      />
    </TwitterCloneSecondaryPageLayout>
  )
}
