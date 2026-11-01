import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { notFound, permanentRedirect } from 'next/navigation'
import { cache } from 'react'

import { fetchJson } from '../../../lib/client-api.js'
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

const PUBLIC_API_ORIGIN = 'https://api.luckread.com'
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
  fetchJson<PublicContent>(
    new Request(PUBLIC_API_ORIGIN + '/v1/contents/' + encodeURIComponent(contentId), {
      method: 'GET',
      headers: headersForRequest,
      cache: 'no-store',
    }),
  )

const getPublicContent = cache(async (contentId: string): Promise<PublicContent | null> => {
  const headersForRequest = await requestHeaders()
  try {
    let result = await fetchContentById(contentId, headersForRequest)
    if (result.response.status === 404) {
      const fallbackId = uuidFromStableContentSlug(contentId)
      if (fallbackId) result = await fetchContentById(fallbackId, headersForRequest)
    }
    if (!result.response.ok || !result.data || typeof result.data.id !== 'string') return null
    return result.data
  } catch {
    return null
  }
})

const getPublicAuthorById = cache(async (userId: string): Promise<PublicAuthor | null> => {
  const normalized = userId.trim()
  if (!normalized || normalized.length > 128) return null
  try {
    const result = await fetchJson<PublicAuthor>(
      new Request(PUBLIC_API_ORIGIN + '/v1/users/' + encodeURIComponent(normalized), {
        method: 'GET',
        headers: await requestHeaders(),
        cache: 'no-store',
      }),
    )
    if (!result.response.ok || !result.data || typeof result.data.username !== 'string') return null
    return result.data
  } catch {
    return null
  }
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
  const canonical = canonicalPath(author, content, input.routeType)

  const requestedPath =
    '/@' + encodeURIComponent(requestedUsername) + '/' +
    input.routeType + '/' + encodeURIComponent(input.contentId)

  // Redirect only when the canonical URL is actually different. Comparing
  // individual fields can trigger a 308 to the exact same URL when upstream
  // identity values differ only in representation.
  if (requestedPath !== canonical) permanentRedirect(canonical)

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
