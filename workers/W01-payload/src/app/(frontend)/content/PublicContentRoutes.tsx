import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'

import { getPublicContentDetailResponse } from '../../../content/public-content-detail-reader.js'
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

  const embedded = content.creator?.username
    ? content.creator
    : content.author?.username
      ? content.author
      : null
  if (embedded?.username) {
    return {
      content,
      author: {
        id: embedded.id || content.creatorId || content.ownerUserId || '',
        username: embedded.username,
        displayName: embedded.displayName ?? null,
        avatar: embedded.avatar ?? null,
      },
    }
  }

  const ownerIds = [
    content.creatorId,
    content.ownerUserId,
    content.creator?.id,
    content.creator?.userId,
    content.author?.id,
    content.author?.userId,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (ownerIds.length === 0) {
    throw new Error('PUBLIC_CONTENT_AUTHOR_ID_MISSING')
  }

  const authors = await Promise.all(
    [...new Set(ownerIds)].map((ownerId) => getPublicAuthorById(ownerId)),
  )
  const author = authors.find((candidate): candidate is PublicAuthor =>
    Boolean(candidate?.username),
  )
  return { content, author: author ?? null }
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

  const requestedUsername = input.username.trim().replace(/^@+/, '')
  const canonicalUsername = author.username.trim().replace(/^@+/, '')

  // The username/content detail routes are already the public canonical route.
  // Do not issue a 308 from a canonical route: even a URL-equivalent redirect
  // can be cached by browsers/CDNs as a permanent self-redirect.
  // Reject a mismatched author or content-type path instead of redirecting.
  if (!requestedUsername || requestedUsername.toLowerCase() !== canonicalUsername.toLowerCase()) {
    notFound()
  }
  if (routeTypeForContent(content, input.routeType) !== input.routeType) notFound()

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
